import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../client.ts";
import { refreshSessions } from "../schema/refresh-sessions.ts";
import { users } from "../schema/users.ts";
import {
  expectPgError,
  fakeTokenHash,
  insertRefreshSession,
  insertUser,
  PG_ERRORS,
} from "../test-support/factories.ts";
import { connectTestDatabase, resetTables } from "../test-support/test-database.ts";

describe("refresh_sessions", () => {
  let handle: DatabaseHandle;

  beforeAll(() => {
    handle = connectTestDatabase();
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await resetTables(handle);
  });

  it("inserts a session that is not revoked", async () => {
    const user = await insertUser(handle.db);
    const session = await insertRefreshSession(handle.db, user.id);

    expect(session.revokedAt).toBeNull();
    expect(session.userId).toBe(user.id);
    expect(session.createdAt).toBeInstanceOf(Date);
  });

  it("allows many sessions in one family (rotation)", async () => {
    const user = await insertUser(handle.db);
    const familyId = crypto.randomUUID();

    await insertRefreshSession(handle.db, user.id, { familyId });
    await insertRefreshSession(handle.db, user.id, { familyId });
    await insertRefreshSession(handle.db, user.id, { familyId });

    const rows = await handle.db
      .select()
      .from(refreshSessions)
      .where(eq(refreshSessions.familyId, familyId));
    expect(rows).toHaveLength(3);
  });

  it("rejects a duplicate token hash", async () => {
    const user = await insertUser(handle.db);
    const tokenHash = fakeTokenHash();
    await insertRefreshSession(handle.db, user.id, { tokenHash });

    await expectPgError(
      insertRefreshSession(handle.db, user.id, { tokenHash }),
      PG_ERRORS.uniqueViolation,
      "refresh_sessions_token_hash_unique",
    );
  });

  it("rejects a duplicate token hash even across different users", async () => {
    const first = await insertUser(handle.db);
    const second = await insertUser(handle.db);
    const tokenHash = fakeTokenHash();
    await insertRefreshSession(handle.db, first.id, { tokenHash });

    await expectPgError(
      insertRefreshSession(handle.db, second.id, { tokenHash }),
      PG_ERRORS.uniqueViolation,
      "refresh_sessions_token_hash_unique",
    );
  });

  describe("token hash format", () => {
    it.each([
      ["uppercase hex", "A".repeat(64)],
      ["63 characters", "a".repeat(63)],
      ["65 characters", "a".repeat(65)],
      ["non-hex characters", "g".repeat(64)],
      ["an empty string", ""],
      ["a raw token with a prefix", `Bearer ${"a".repeat(57)}`],
    ])("rejects %s", async (_label, tokenHash) => {
      const user = await insertUser(handle.db);

      await expectPgError(
        insertRefreshSession(handle.db, user.id, { tokenHash }),
        PG_ERRORS.checkViolation,
        "refresh_sessions_token_hash_format",
      );
    });

    it("accepts exactly 64 lowercase hex characters", async () => {
      const user = await insertUser(handle.db);

      await expect(
        insertRefreshSession(handle.db, user.id, { tokenHash: "0123456789abcdef".repeat(4) }),
      ).resolves.toBeDefined();
    });
  });

  it("rejects a session for a user that does not exist", async () => {
    await expectPgError(
      insertRefreshSession(handle.db, crypto.randomUUID()),
      PG_ERRORS.foreignKeyViolation,
      "refresh_sessions_user_id_users_id_fk",
    );
  });

  it("rejects an expiry that is not after the creation time", async () => {
    const user = await insertUser(handle.db);

    await expectPgError(
      insertRefreshSession(handle.db, user.id, { expiresAt: new Date(Date.now() - 60_000) }),
      PG_ERRORS.checkViolation,
      "refresh_sessions_expires_after_created",
    );
  });

  it("rejects NULL for user_id, family_id, token_hash and expires_at", async () => {
    const user = await insertUser(handle.db);
    const hash = fakeTokenHash();
    const values = {
      user_id: `'${user.id}'`,
      family_id: `'${crypto.randomUUID()}'`,
      token_hash: `'${hash}'`,
      expires_at: "now() + interval '1 hour'",
    };

    for (const column of Object.keys(values) as (keyof typeof values)[]) {
      const row = { ...values, [column]: "null" };
      await expectPgError(
        handle.pool.query(
          `insert into refresh_sessions (${Object.keys(row).join(", ")}) values (${Object.values(row).join(", ")})`,
        ),
        PG_ERRORS.notNullViolation,
      );
    }
  });

  it("can be revoked by setting revoked_at", async () => {
    const user = await insertUser(handle.db);
    const session = await insertRefreshSession(handle.db, user.id);
    const revokedAt = new Date();

    await handle.db
      .update(refreshSessions)
      .set({ revokedAt })
      .where(eq(refreshSessions.id, session.id));

    const [row] = await handle.db
      .select()
      .from(refreshSessions)
      .where(eq(refreshSessions.id, session.id));
    expect(row?.revokedAt?.getTime()).toBe(revokedAt.getTime());
  });

  it("is deleted together with its user", async () => {
    const user = await insertUser(handle.db);
    const other = await insertUser(handle.db);
    await insertRefreshSession(handle.db, user.id);
    await insertRefreshSession(handle.db, user.id);
    await insertRefreshSession(handle.db, other.id);

    await handle.db.delete(users).where(eq(users.id, user.id));

    const remaining = await handle.db.select().from(refreshSessions);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.userId).toBe(other.id);
  });
});
