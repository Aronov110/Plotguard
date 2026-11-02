import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../../db/client.ts";
import { insertUser, uniqueEmail } from "../../db/test-support/factories.ts";
import { connectTestDatabase, resetTables } from "../../db/test-support/test-database.ts";
import {
  createUser,
  EmailTakenError,
  findUserByEmail,
  findUserById,
  toPublicUser,
  updatePasswordHash,
} from "../users.ts";

const HASH = "$argon2id$v=19$m=8,t=1,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaA";

describe("users", () => {
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

  describe("createUser", () => {
    it("stores the user and returns it with an id and timestamps", async () => {
      const user = await createUser(handle.db, {
        email: "mara@example.com",
        passwordHash: HASH,
        displayName: "Mara",
      });
      expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(user).toMatchObject({ email: "mara@example.com", displayName: "Mara" });
      expect(user.createdAt).toBeInstanceOf(Date);
    });

    it("allows no display name", async () => {
      const user = await createUser(handle.db, {
        email: uniqueEmail(),
        passwordHash: HASH,
        displayName: null,
      });
      expect(user.displayName).toBeNull();
    });

    it("throws EmailTakenError for a duplicate email", async () => {
      const email = uniqueEmail();
      await insertUser(handle.db, { email });
      await expect(
        createUser(handle.db, { email, passwordHash: HASH, displayName: null }),
      ).rejects.toBeInstanceOf(EmailTakenError);
    });

    it("lets exactly one of several simultaneous sign-ups for one email win", async () => {
      const email = uniqueEmail();
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          createUser(handle.db, { email, passwordHash: HASH, displayName: null }),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(failures).toHaveLength(7);
      for (const failure of failures) expect(failure.reason).toBeInstanceOf(EmailTakenError);
    });

    it("does not turn other database errors into EmailTakenError", async () => {
      // Upper case breaks the lowercase CHECK. The caller must normalise first.
      await expect(
        createUser(handle.db, {
          email: "UPPER@EXAMPLE.COM",
          passwordHash: HASH,
          displayName: null,
        }),
      ).rejects.not.toBeInstanceOf(EmailTakenError);
    });
  });

  describe("findUserByEmail", () => {
    it("finds a user by the stored (lowercase) email", async () => {
      const created = await insertUser(handle.db, { email: "find.me@example.com" });
      const found = await findUserByEmail(handle.db, "find.me@example.com");
      expect(found?.id).toBe(created.id);
    });

    it("returns undefined for an unknown email", async () => {
      await expect(findUserByEmail(handle.db, "nobody@example.com")).resolves.toBeUndefined();
    });

    it("is an exact match: the caller normalises, the query does not guess", async () => {
      await insertUser(handle.db, { email: "exact@example.com" });
      await expect(findUserByEmail(handle.db, "EXACT@example.com")).resolves.toBeUndefined();
    });

    it("treats SQL-looking input as plain text", async () => {
      await insertUser(handle.db, { email: "safe@example.com" });
      await expect(findUserByEmail(handle.db, "' OR '1'='1")).resolves.toBeUndefined();
      await expect(findUserByEmail(handle.db, "x'; DROP TABLE users;--")).resolves.toBeUndefined();
      await expect(findUserByEmail(handle.db, "safe@example.com")).resolves.toBeDefined();
    });

    it("treats LIKE wildcards as plain text", async () => {
      await insertUser(handle.db, { email: "wild@example.com" });
      await expect(findUserByEmail(handle.db, "%@example.com")).resolves.toBeUndefined();
      await expect(findUserByEmail(handle.db, "w_ld@example.com")).resolves.toBeUndefined();
    });
  });

  describe("findUserById", () => {
    it("finds a user", async () => {
      const created = await insertUser(handle.db);
      await expect(findUserById(handle.db, created.id)).resolves.toMatchObject({ id: created.id });
    });

    it("returns undefined for an unknown id", async () => {
      await expect(
        findUserById(handle.db, "0190a000-0000-7000-8000-000000000000"),
      ).resolves.toBeUndefined();
    });

    it("returns undefined, not an error, for something that is not a UUID", async () => {
      await expect(findUserById(handle.db, "not-a-uuid")).resolves.toBeUndefined();
      await expect(findUserById(handle.db, "")).resolves.toBeUndefined();
    });
  });

  describe("updatePasswordHash", () => {
    it("replaces the hash and touches updated_at", async () => {
      const created = await insertUser(handle.db);
      await new Promise((resolve) => setTimeout(resolve, 15));
      await updatePasswordHash(handle.db, created.id, HASH);
      const after = await findUserById(handle.db, created.id);
      expect(after?.passwordHash).toBe(HASH);
      expect(after?.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());
    });

    it("does nothing for an unknown user", async () => {
      await expect(
        updatePasswordHash(handle.db, "0190a000-0000-7000-8000-000000000000", HASH),
      ).resolves.toBeUndefined();
    });

    it("changes only that user", async () => {
      const a = await insertUser(handle.db);
      const b = await insertUser(handle.db);
      await updatePasswordHash(handle.db, a.id, HASH);
      expect((await findUserById(handle.db, b.id))?.passwordHash).toBe(b.passwordHash);
    });
  });

  describe("toPublicUser", () => {
    it("keeps only id, email and display name", async () => {
      const created = await insertUser(handle.db, { displayName: "Mara" });
      const pub = toPublicUser(created);
      expect(pub).toEqual({ id: created.id, email: created.email, displayName: "Mara" });
      expect(JSON.stringify(pub)).not.toContain("password");
      expect(JSON.stringify(pub)).not.toContain(created.passwordHash);
    });
  });
});
