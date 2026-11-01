import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../client.ts";
import { users } from "../schema/users.ts";
import { expectPgError, insertUser, PG_ERRORS, uniqueEmail } from "../test-support/factories.ts";
import { connectTestDatabase, resetTables } from "../test-support/test-database.ts";

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

  it("inserts a minimal row and fills in the defaults", async () => {
    const user = await insertUser(handle.db);

    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user.displayName).toBeNull();
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.updatedAt).toBeInstanceOf(Date);
  });

  it("stores and returns a display name", async () => {
    const user = await insertUser(handle.db, { displayName: "Mara" });

    expect(user.displayName).toBe("Mara");
  });

  describe("email", () => {
    it("rejects a duplicate email with a unique violation", async () => {
      const email = uniqueEmail();
      await insertUser(handle.db, { email });

      await expectPgError(
        insertUser(handle.db, { email }),
        PG_ERRORS.uniqueViolation,
        "users_email_unique",
      );
    });

    it("rejects an email that is not lowercase", async () => {
      await expectPgError(
        insertUser(handle.db, { email: "Mixed.Case@Example.test" }),
        PG_ERRORS.checkViolation,
        "users_email_lowercase",
      );
    });

    it("rejects a differently-cased copy of an existing email", async () => {
      await insertUser(handle.db, { email: "dup@example.test" });

      await expectPgError(
        insertUser(handle.db, { email: "DUP@example.test" }),
        PG_ERRORS.checkViolation,
        "users_email_lowercase",
      );
    });

    it("rejects an empty email", async () => {
      await expectPgError(
        insertUser(handle.db, { email: "" }),
        PG_ERRORS.checkViolation,
        "users_email_length",
      );
    });

    it("rejects a 2-character email and accepts a 3-character one", async () => {
      await expectPgError(
        insertUser(handle.db, { email: "ab" }),
        PG_ERRORS.checkViolation,
        "users_email_length",
      );
      await expect(insertUser(handle.db, { email: "a@b" })).resolves.toMatchObject({
        email: "a@b",
      });
    });

    it("accepts a 254-character email and rejects a 255-character one", async () => {
      const make = (length: number) => `${"a".repeat(length - "@x.test".length)}@x.test`;

      await expect(insertUser(handle.db, { email: make(254) })).resolves.toBeDefined();
      await expectPgError(
        insertUser(handle.db, { email: make(255) }),
        PG_ERRORS.checkViolation,
        "users_email_length",
      );
    });

    it("rejects a NULL email", async () => {
      await expectPgError(
        handle.pool.query("insert into users (email, password_hash) values (null, 'h')"),
        PG_ERRORS.notNullViolation,
      );
    });

    it("keeps unicode emails intact", async () => {
      const email = "jürgen@exämple.test";
      const user = await insertUser(handle.db, { email });

      expect(user.email).toBe(email);
    });
  });

  describe("password_hash", () => {
    it("rejects an empty hash", async () => {
      await expectPgError(
        insertUser(handle.db, { passwordHash: "" }),
        PG_ERRORS.checkViolation,
        "users_password_hash_not_empty",
      );
    });

    it("rejects a NULL hash", async () => {
      await expectPgError(
        handle.pool.query("insert into users (email, password_hash) values ('n@x.test', null)"),
        PG_ERRORS.notNullViolation,
      );
    });
  });

  describe("display_name", () => {
    it("accepts NULL", async () => {
      await expect(insertUser(handle.db, { displayName: null })).resolves.toBeDefined();
    });

    it("rejects an empty string", async () => {
      await expectPgError(
        insertUser(handle.db, { displayName: "" }),
        PG_ERRORS.checkViolation,
        "users_display_name_length",
      );
    });

    it("accepts 1 and 80 characters and rejects 81", async () => {
      await expect(insertUser(handle.db, { displayName: "a" })).resolves.toBeDefined();
      await expect(insertUser(handle.db, { displayName: "a".repeat(80) })).resolves.toBeDefined();
      await expectPgError(
        insertUser(handle.db, { displayName: "a".repeat(81) }),
        PG_ERRORS.checkViolation,
        "users_display_name_length",
      );
    });

    it("counts characters, not bytes", async () => {
      // 80 emoji is 320 bytes in UTF-8 but 80 characters.
      await expect(insertUser(handle.db, { displayName: "😀".repeat(80) })).resolves.toBeDefined();
    });
  });

  it("can be updated and deleted", async () => {
    const user = await insertUser(handle.db);

    await handle.db.update(users).set({ displayName: "Renamed" }).where(eq(users.id, user.id));
    const [updated] = await handle.db.select().from(users).where(eq(users.id, user.id));
    expect(updated?.displayName).toBe("Renamed");

    await handle.db.delete(users).where(eq(users.id, user.id));
    expect(await handle.db.select().from(users).where(eq(users.id, user.id))).toEqual([]);
  });
});
