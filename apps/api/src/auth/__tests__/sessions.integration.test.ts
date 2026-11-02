import { randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../../db/client.ts";
import { refreshSessions } from "../../db/schema/refresh-sessions.ts";
import { users } from "../../db/schema/users.ts";
import { insertUser } from "../../db/test-support/factories.ts";
import { connectTestDatabase, resetTables } from "../../db/test-support/test-database.ts";
import {
  createSession,
  findLiveSession,
  type RotateOptions,
  revokeFamilyByToken,
  rotateSession,
} from "../sessions.ts";

const hash = () => randomBytes(32).toString("hex");
const POLICY = { ttlDays: 30, absoluteDays: 90, graceSeconds: 10 } as const;
const DAY_MS = 24 * 60 * 60 * 1000;

describe("refresh sessions", () => {
  let handle: DatabaseHandle;
  let userId: string;

  beforeAll(() => {
    handle = connectTestDatabase();
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await resetTables(handle);
    userId = (await insertUser(handle.db)).id;
  });

  const db = () => handle.db;
  const rows = (familyId: string) =>
    db().select().from(refreshSessions).where(eq(refreshSessions.familyId, familyId));
  const row = async (tokenHash: string) =>
    (await db().select().from(refreshSessions).where(eq(refreshSessions.tokenHash, tokenHash)))[0];

  async function start(overrides: { userId?: string; familyId?: string } = {}) {
    const tokenHash = hash();
    const familyId = overrides.familyId ?? randomUUID();
    const { expiresAt } = await createSession(db(), {
      userId: overrides.userId ?? userId,
      familyId,
      tokenHash,
      ttlDays: POLICY.ttlDays,
    });
    return { tokenHash, familyId, expiresAt };
  }

  const rotate = (tokenHash: string, newTokenHash = hash(), policy: Partial<RotateOptions> = {}) =>
    rotateSession(db(), { tokenHash, newTokenHash, ...POLICY, ...policy });

  /** Moves a row's revocation time into the past, to test the grace window. */
  const revokedSecondsAgo = (tokenHash: string, seconds: number) =>
    db().execute(
      sql`update refresh_sessions set revoked_at = now() - make_interval(secs => ${seconds}::int)
          where token_hash = ${tokenHash}`,
    );

  describe("createSession", () => {
    it("stores only the hash and gives back the expiry", async () => {
      const { tokenHash, familyId, expiresAt } = await start();
      const [stored] = await rows(familyId);
      expect(stored?.tokenHash).toBe(tokenHash);
      expect(stored?.userId).toBe(userId);
      expect(stored?.revokedAt).toBeNull();
      const expectedMs = Date.now() + POLICY.ttlDays * DAY_MS;
      expect(Math.abs(expiresAt.getTime() - expectedMs)).toBeLessThan(60_000);
      expect(stored?.expiresAt.getTime()).toBe(expiresAt.getTime());
    });

    it("refuses the same hash twice", async () => {
      const { tokenHash } = await start();
      await expect(
        createSession(db(), { userId, familyId: randomUUID(), tokenHash, ttlDays: 30 }),
      ).rejects.toThrow();
    });

    it("refuses a hash that is not 64 lowercase hex characters", async () => {
      for (const bad of ["abc", hash().toUpperCase(), `${hash()}0`, ""]) {
        await expect(
          createSession(db(), { userId, familyId: randomUUID(), tokenHash: bad, ttlDays: 30 }),
        ).rejects.toThrow();
      }
    });

    it("refuses a user that does not exist", async () => {
      await expect(
        createSession(db(), {
          userId: "0190a000-0000-7000-8000-000000000000",
          familyId: randomUUID(),
          tokenHash: hash(),
          ttlDays: 30,
        }),
      ).rejects.toThrow();
    });

    it.each([0, -1, 1.5, Number.NaN, 100_000])("refuses a lifetime of %s days", async (ttlDays) => {
      await expect(
        createSession(db(), { userId, familyId: randomUUID(), tokenHash: hash(), ttlDays }),
      ).rejects.toThrow(RangeError);
    });
  });

  describe("findLiveSession", () => {
    it("finds a current session", async () => {
      const { tokenHash, familyId } = await start();
      await expect(findLiveSession(db(), tokenHash)).resolves.toEqual({ userId, familyId });
    });

    it("does not find an unknown hash", async () => {
      await expect(findLiveSession(db(), hash())).resolves.toBeUndefined();
    });

    it("does not find a revoked session", async () => {
      const { tokenHash } = await start();
      await revokeFamilyByToken(db(), tokenHash);
      await expect(findLiveSession(db(), tokenHash)).resolves.toBeUndefined();
    });

    it("does not find an expired session", async () => {
      const { tokenHash } = await start();
      await db().execute(
        sql`update refresh_sessions
            set created_at = now() - interval '2 days', expires_at = now() - interval '1 day'
            where token_hash = ${tokenHash}`,
      );
      await expect(findLiveSession(db(), tokenHash)).resolves.toBeUndefined();
    });
  });

  describe("rotateSession", () => {
    it("swaps the old token for a new one in the same family", async () => {
      const { tokenHash, familyId } = await start();
      const next = hash();
      const result = await rotate(tokenHash, next);

      expect(result).toMatchObject({ status: "rotated", userId, familyId });
      expect((await row(tokenHash))?.revokedAt).toBeInstanceOf(Date);
      const fresh = await row(next);
      expect(fresh?.revokedAt).toBeNull();
      expect(fresh?.familyId).toBe(familyId);
      expect(fresh?.userId).toBe(userId);
      expect(await rows(familyId)).toHaveLength(2);
    });

    it("sets the new expiry from now", async () => {
      const { tokenHash } = await start();
      const result = await rotate(tokenHash);
      if (result.status !== "rotated") throw new Error("expected a rotation");
      const expectedMs = Date.now() + POLICY.ttlDays * DAY_MS;
      expect(Math.abs(result.expiresAt.getTime() - expectedMs)).toBeLessThan(60_000);
    });

    it("can be repeated, and the family stays the same", async () => {
      const first = await start();
      let current = first.tokenHash;
      for (let i = 0; i < 4; i++) {
        const next = hash();
        const result = await rotate(current, next);
        expect(result).toMatchObject({ status: "rotated", familyId: first.familyId });
        current = next;
      }
      expect(await rows(first.familyId)).toHaveLength(5);
      await expect(findLiveSession(db(), current)).resolves.toBeDefined();
    });

    it("says invalid for an unknown token and changes nothing", async () => {
      const { familyId } = await start();
      await expect(rotate(hash())).resolves.toEqual({ status: "invalid" });
      expect(await rows(familyId)).toHaveLength(1);
    });

    it("says invalid for an expired token and neither revokes nor adds anything", async () => {
      const { tokenHash, familyId } = await start();
      await db().execute(
        sql`update refresh_sessions
            set created_at = now() - interval '2 days', expires_at = now() - interval '1 day'
            where token_hash = ${tokenHash}`,
      );
      await expect(rotate(tokenHash)).resolves.toEqual({ status: "invalid" });
      const all = await rows(familyId);
      expect(all).toHaveLength(1);
      expect(all[0]?.revokedAt).toBeNull();
    });

    describe("a token that was already used", () => {
      it("is only refused, with nothing revoked, inside the grace window", async () => {
        const { tokenHash, familyId } = await start();
        const next = hash();
        await rotate(tokenHash, next);

        await expect(rotate(tokenHash)).resolves.toEqual({ status: "grace" });
        expect((await row(next))?.revokedAt).toBeNull();
        expect(await rows(familyId)).toHaveLength(2);
      });

      it("revokes the whole family once the grace window has passed", async () => {
        const { tokenHash, familyId } = await start();
        const next = hash();
        await rotate(tokenHash, next);
        await revokedSecondsAgo(tokenHash, 11);

        await expect(rotate(tokenHash)).resolves.toEqual({ status: "reuse", userId, familyId });
        expect((await row(next))?.revokedAt).toBeInstanceOf(Date);
        await expect(findLiveSession(db(), next)).resolves.toBeUndefined();
      });

      it("treats 9 seconds as grace and 11 seconds as reuse when the window is 10", async () => {
        const a = await start();
        await rotate(a.tokenHash);
        await revokedSecondsAgo(a.tokenHash, 9);
        await expect(rotate(a.tokenHash)).resolves.toEqual({ status: "grace" });

        const b = await start();
        await rotate(b.tokenHash);
        await revokedSecondsAgo(b.tokenHash, 11);
        await expect(rotate(b.tokenHash)).resolves.toMatchObject({ status: "reuse" });
      });

      it("is reuse straight away when the grace window is 0", async () => {
        const { tokenHash } = await start();
        await rotate(tokenHash);
        await new Promise((resolve) => setTimeout(resolve, 20));
        await expect(rotate(tokenHash, hash(), { graceSeconds: 0 })).resolves.toMatchObject({
          status: "reuse",
        });
      });

      it("is reuse when the oldest token of a long chain comes back", async () => {
        const first = await start();
        let current = first.tokenHash;
        const chain = [current];
        for (let i = 0; i < 3; i++) {
          const next = hash();
          await rotate(current, next);
          current = next;
          chain.push(next);
        }
        const oldest = chain[0] as string;
        await revokedSecondsAgo(oldest, 600);

        await expect(rotate(oldest)).resolves.toMatchObject({ status: "reuse" });
        for (const token of chain) {
          await expect(findLiveSession(db(), token)).resolves.toBeUndefined();
        }
      });

      it("leaves other logins of the same user alone", async () => {
        const mine = await start();
        const other = await start();
        await rotate(mine.tokenHash);
        await revokedSecondsAgo(mine.tokenHash, 60);
        await rotate(mine.tokenHash);
        await expect(findLiveSession(db(), other.tokenHash)).resolves.toBeDefined();
      });

      it("leaves other users alone", async () => {
        const otherUser = (await insertUser(handle.db)).id;
        const mine = await start();
        const theirs = await start({ userId: otherUser });
        await rotate(mine.tokenHash);
        await revokedSecondsAgo(mine.tokenHash, 60);
        await rotate(mine.tokenHash);
        await expect(findLiveSession(db(), theirs.tokenHash)).resolves.toEqual({
          userId: otherUser,
          familyId: theirs.familyId,
        });
      });

      it("is also grace/reuse after a logout, never a new login", async () => {
        const { tokenHash } = await start();
        await revokeFamilyByToken(db(), tokenHash);
        const result = await rotate(tokenHash);
        expect(["grace", "reuse"]).toContain(result.status);
        await expect(findLiveSession(db(), tokenHash)).resolves.toBeUndefined();
      });
    });

    describe("two requests with the same token at the same moment", () => {
      it("let exactly one win, and nobody is thrown out", async () => {
        const { tokenHash, familyId } = await start();
        const attempts = await Promise.all(Array.from({ length: 10 }, () => rotate(tokenHash)));

        expect(attempts.filter((a) => a.status === "rotated")).toHaveLength(1);
        expect(attempts.filter((a) => a.status === "grace")).toHaveLength(9);
        const family = await rows(familyId);
        expect(family).toHaveLength(2);
        expect(family.filter((r) => r.revokedAt === null)).toHaveLength(1);
      });

      it("work for many different logins at once", async () => {
        const logins = await Promise.all(Array.from({ length: 6 }, () => start()));
        const results = await Promise.all(logins.map((l) => rotate(l.tokenHash)));
        expect(results.every((r) => r.status === "rotated")).toBe(true);
      });
    });

    describe("the lifetime limit of a login", () => {
      it("cuts the new expiry short when the login is close to its absolute end", async () => {
        const { tokenHash, familyId } = await start();
        // The login began 85 days ago; its current token is still valid for 10 more days.
        await db().execute(
          sql`update refresh_sessions
              set created_at = now() - interval '85 days', expires_at = now() + interval '10 days'
              where token_hash = ${tokenHash}`,
        );
        const result = await rotate(tokenHash);
        if (result.status !== "rotated") throw new Error("expected a rotation");

        const fiveDaysMs = 5 * DAY_MS;
        expect(Math.abs(result.expiresAt.getTime() - (Date.now() + fiveDaysMs))).toBeLessThan(
          60_000,
        );
        const newest = (await rows(familyId)).find((r) => r.revokedAt === null);
        expect(newest?.expiresAt.getTime()).toBe(result.expiresAt.getTime());
      });

      it("does not shorten a fresh login", async () => {
        const { tokenHash } = await start();
        const result = await rotate(tokenHash);
        if (result.status !== "rotated") throw new Error("expected a rotation");
        const thirtyDaysMs = 30 * DAY_MS;
        expect(Math.abs(result.expiresAt.getTime() - (Date.now() + thirtyDaysMs))).toBeLessThan(
          60_000,
        );
      });

      it("never produces an expiry in the past", async () => {
        const { tokenHash } = await start();
        // 89 days old and valid for 2 more: the new token gets about 1 day, still in the future.
        await db().execute(
          sql`update refresh_sessions
              set created_at = now() - interval '89 days', expires_at = now() + interval '2 days'
              where token_hash = ${tokenHash}`,
        );
        const result = await rotate(tokenHash);
        if (result.status !== "rotated") throw new Error("expected a rotation");
        expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
      });
    });

    describe("when something goes wrong half way", () => {
      it("keeps the old token usable if the new hash already exists", async () => {
        const first = await start();
        const second = await start();
        // The new hash collides with another session's hash, so the insert fails.
        await expect(rotate(first.tokenHash, second.tokenHash)).rejects.toThrow();
        await expect(findLiveSession(db(), first.tokenHash)).resolves.toBeDefined();
        expect((await row(first.tokenHash))?.revokedAt).toBeNull();
      });

      it("keeps the old token usable if the new hash is malformed", async () => {
        const { tokenHash } = await start();
        await expect(rotate(tokenHash, "not-hex")).rejects.toThrow();
        await expect(findLiveSession(db(), tokenHash)).resolves.toBeDefined();
      });
    });

    it.each([
      ["ttlDays 0", { ttlDays: 0 }],
      ["ttlDays 1.5", { ttlDays: 1.5 }],
      ["absoluteDays 0", { absoluteDays: 0 }],
      ["graceSeconds -1", { graceSeconds: -1 }],
      ["graceSeconds 1.5", { graceSeconds: 1.5 }],
      ["graceSeconds NaN", { graceSeconds: Number.NaN }],
    ])("refuses %s", async (_label, policy) => {
      const { tokenHash } = await start();
      await expect(rotate(tokenHash, hash(), policy)).rejects.toThrow(RangeError);
      await expect(findLiveSession(db(), tokenHash)).resolves.toBeDefined();
    });
  });

  describe("revokeFamilyByToken", () => {
    it("revokes every live token of the login and reports how many", async () => {
      const { tokenHash, familyId } = await start();
      const next = hash();
      await rotate(tokenHash, next);
      await expect(revokeFamilyByToken(db(), next)).resolves.toBe(1);
      expect((await rows(familyId)).every((r) => r.revokedAt !== null)).toBe(true);
    });

    it("can be called again: nothing left to revoke", async () => {
      const { tokenHash } = await start();
      await expect(revokeFamilyByToken(db(), tokenHash)).resolves.toBe(1);
      await expect(revokeFamilyByToken(db(), tokenHash)).resolves.toBe(0);
    });

    it("does nothing for an unknown token", async () => {
      await start();
      await expect(revokeFamilyByToken(db(), hash())).resolves.toBe(0);
    });

    it("leaves other logins and other users alone", async () => {
      const otherUser = (await insertUser(handle.db)).id;
      const mine = await start();
      const another = await start();
      const theirs = await start({ userId: otherUser });
      await revokeFamilyByToken(db(), mine.tokenHash);
      await expect(findLiveSession(db(), another.tokenHash)).resolves.toBeDefined();
      await expect(findLiveSession(db(), theirs.tokenHash)).resolves.toBeDefined();
    });

    it("also works from the token of an older, already revoked step of the chain", async () => {
      const { tokenHash, familyId } = await start();
      const next = hash();
      await rotate(tokenHash, next);
      await expect(revokeFamilyByToken(db(), tokenHash)).resolves.toBe(1);
      await expect(findLiveSession(db(), next)).resolves.toBeUndefined();
      expect((await rows(familyId)).every((r) => r.revokedAt !== null)).toBe(true);
    });
  });

  describe("when the user is deleted", () => {
    it("takes all of their sessions with it", async () => {
      const { tokenHash, familyId } = await start();
      await db().delete(users).where(eq(users.id, userId));
      expect(await rows(familyId)).toHaveLength(0);
      await expect(findLiveSession(db(), tokenHash)).resolves.toBeUndefined();
      await expect(rotate(tokenHash)).resolves.toEqual({ status: "invalid" });
    });
  });
});
