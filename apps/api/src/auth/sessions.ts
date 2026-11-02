import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import { refreshSessions } from "../db/schema/refresh-sessions.ts";

const MAX_DAYS = 3650;
const MAX_GRACE_SECONDS = 3600;

function assertWholeNumber(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be a whole number from ${min} to ${max}`);
  }
}

/** Anything that can run a query: the database itself or a transaction. */
type Executor = Pick<Database, "execute" | "select">;

async function familyOf(executor: Executor, tokenHash: string): Promise<string | undefined> {
  const [row] = await executor
    .select({ familyId: refreshSessions.familyId })
    .from(refreshSessions)
    .where(eq(refreshSessions.tokenHash, tokenHash))
    .limit(1);
  return row?.familyId;
}

/**
 * Makes changes to one login happen one at a time, until the transaction ends.
 *
 * Why: under READ COMMITTED a statement only sees rows that were committed before it began. A
 * logout that starts while a rotation is half done would revoke the old token (once the rotation
 * commits) but never see the new token, which the rotation inserted after the logout's snapshot.
 * The new token would then stay alive after a logout that reported success. With the lock, the
 * later statement starts only after the earlier one has committed.
 *
 * Different logins use different keys and never wait for each other.
 */
async function lockFamily(executor: Executor, familyId: string): Promise<void> {
  await executor.execute(sql`select pg_advisory_xact_lock(hashtextextended(${familyId}::text, 0))`);
}

export interface NewSession {
  readonly userId: string;
  /** All tokens of one login share a family id. */
  readonly familyId: string;
  /** SHA-256 hex of the token. The token itself is never stored. */
  readonly tokenHash: string;
  readonly ttlDays: number;
}

/** Stores the first token of a new login. The expiry is computed by the database clock. */
export async function createSession(
  db: Database,
  session: NewSession,
): Promise<{ expiresAt: Date }> {
  assertWholeNumber("ttlDays", session.ttlDays, 1, MAX_DAYS);
  const result = await db.execute<{ expires_at: Date | string }>(sql`
    insert into refresh_sessions (user_id, family_id, token_hash, expires_at)
    values (${session.userId}::uuid, ${session.familyId}::uuid, ${session.tokenHash},
            now() + make_interval(days => ${session.ttlDays}::int))
    returning expires_at`);
  const row = result.rows[0];
  if (row === undefined) throw new Error("The insert returned no row");
  return { expiresAt: new Date(row.expires_at) };
}

/**
 * The user and login family of a token in ANY state: live, replaced, logged out or expired.
 * Unknown hashes give `undefined`. The CSRF check needs the family before anything is rotated,
 * and a replayed old token must still get that far so the theft detection can see it.
 */
export async function findSessionFamily(
  db: Database,
  tokenHash: string,
): Promise<{ userId: string; familyId: string } | undefined> {
  const [row] = await db
    .select({ userId: refreshSessions.userId, familyId: refreshSessions.familyId })
    .from(refreshSessions)
    .where(eq(refreshSessions.tokenHash, tokenHash))
    .limit(1);
  return row;
}

/** The user and login family of a token that is neither revoked nor expired. */
export async function findLiveSession(
  db: Database,
  tokenHash: string,
): Promise<{ userId: string; familyId: string } | undefined> {
  const [row] = await db
    .select({ userId: refreshSessions.userId, familyId: refreshSessions.familyId })
    .from(refreshSessions)
    .where(
      and(
        eq(refreshSessions.tokenHash, tokenHash),
        isNull(refreshSessions.revokedAt),
        gt(refreshSessions.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  return row;
}

export interface RotateOptions {
  readonly tokenHash: string;
  readonly newTokenHash: string;
  /** Lifetime of each token. */
  readonly ttlDays: number;
  /** A login can never last longer than this, however often it is renewed. */
  readonly absoluteDays: number;
  /** How long after use a token is merely refused (a second tab) instead of treated as stolen. */
  readonly graceSeconds: number;
}

export type RotateResult =
  /** The old token is now dead and the new one is stored. */
  | { status: "rotated"; userId: string; familyId: string; expiresAt: Date }
  /** Unknown, expired or deleted. Nothing changed. */
  | { status: "invalid" }
  /** Used a moment ago, probably by a second request. Refused, but nothing is revoked. */
  | { status: "grace" }
  /** A dead token came back after the grace window: the whole login has been revoked. */
  | { status: "reuse"; userId: string; familyId: string };

/**
 * Swaps a refresh token for the next one, all or nothing.
 *
 * The first statement is an atomic compare-and-set: of any number of simultaneous requests with
 * the same token exactly one finds it unrevoked and revokes it. The others see zero rows and are
 * sorted into grace (a harmless race) or reuse (theft) by when the token was revoked.
 */
export async function rotateSession(db: Database, options: RotateOptions): Promise<RotateResult> {
  assertWholeNumber("ttlDays", options.ttlDays, 1, MAX_DAYS);
  assertWholeNumber("absoluteDays", options.absoluteDays, 1, MAX_DAYS);
  assertWholeNumber("graceSeconds", options.graceSeconds, 0, MAX_GRACE_SECONDS);

  return db.transaction(async (tx): Promise<RotateResult> => {
    // Take this login's lock before anything else, so a logout or a theft revocation that starts
    // meanwhile waits and then sees the token this rotation is about to add.
    const familyId = await familyOf(tx, options.tokenHash);
    if (familyId === undefined) return { status: "invalid" };
    await lockFamily(tx, familyId);

    const [won] = await tx
      .update(refreshSessions)
      .set({ revokedAt: sql`now()` })
      .where(
        and(
          eq(refreshSessions.tokenHash, options.tokenHash),
          isNull(refreshSessions.revokedAt),
          gt(refreshSessions.expiresAt, sql`now()`),
        ),
      )
      .returning({ userId: refreshSessions.userId, familyId: refreshSessions.familyId });

    if (won !== undefined) {
      const inserted = await tx.execute<{ expires_at: Date | string }>(sql`
        insert into refresh_sessions (user_id, family_id, token_hash, expires_at)
        select ${won.userId}::uuid, ${won.familyId}::uuid, ${options.newTokenHash},
               least(now() + make_interval(days => ${options.ttlDays}::int),
                     min(created_at) + make_interval(days => ${options.absoluteDays}::int))
        from refresh_sessions
        where family_id = ${won.familyId}::uuid
        returning expires_at`);
      const row = inserted.rows[0];
      if (row === undefined) throw new Error("The insert returned no row");
      return {
        status: "rotated",
        userId: won.userId,
        familyId: won.familyId,
        expiresAt: new Date(row.expires_at),
      };
    }

    const looked = await tx.execute<{
      user_id: string;
      family_id: string;
      revoked: boolean;
      within_grace: boolean;
    }>(sql`
      select user_id, family_id,
             (revoked_at is not null) as revoked,
             (revoked_at is not null
                and revoked_at > now() - make_interval(secs => ${options.graceSeconds}::int))
               as within_grace
      from refresh_sessions
      where token_hash = ${options.tokenHash}`);
    const found = looked.rows[0];

    // Unknown, or expired without ever being used: nothing to learn, nothing to revoke.
    if (found === undefined || !found.revoked) return { status: "invalid" };
    if (found.within_grace) return { status: "grace" };

    const killed = await tx
      .update(refreshSessions)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(refreshSessions.familyId, found.family_id), isNull(refreshSessions.revokedAt)))
      .returning({ id: refreshSessions.id });
    // A dead token coming back after an ordinary logout finds nothing alive to revoke. That is
    // not theft, and reporting it as theft would teach people to ignore the alarm.
    if (killed.length === 0) return { status: "invalid" };
    return { status: "reuse", userId: found.user_id, familyId: found.family_id };
  });
}

/**
 * Ends the whole login that this token belongs to. Works from any token of the family, also an
 * old one. Returns how many tokens were still live; 0 means there was nothing left to revoke.
 */
export async function revokeFamilyByToken(db: Database, tokenHash: string): Promise<number> {
  return db.transaction(async (tx) => {
    const familyId = await familyOf(tx, tokenHash);
    if (familyId === undefined) return 0;
    await lockFamily(tx, familyId);
    const result = await tx.execute(sql`
      update refresh_sessions
      set revoked_at = now()
      where family_id = ${familyId}::uuid and revoked_at is null`);
    return result.rowCount ?? 0;
  });
}
