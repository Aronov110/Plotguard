import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.ts";
import type { DatabaseHandle } from "../../db/client.ts";
import { users } from "../../db/schema/users.ts";
import { insertUser } from "../../db/test-support/factories.ts";
import { connectTestDatabase, resetTables } from "../../db/test-support/test-database.ts";
import { LogCollector } from "../../test-support/log-collector.ts";
import { testEnv } from "../../test-support/test-app.ts";

/**
 * These run real failing queries. They are the tripwire for a Drizzle or pg upgrade that changes
 * the shape of its errors: the unit tests only cover the shapes we know about today.
 */
describe("database errors in the logs", () => {
  let handle: DatabaseHandle;
  let app: FastifyInstance;
  let logs: LogCollector;
  let secret: string;

  beforeEach(async () => {
    secret = `leak${randomBytes(6).toString("hex")}`;
    handle = connectTestDatabase();
    await resetTables(handle);
    logs = new LogCollector();
    // The app owns the pool and closes it in afterEach.
    app = buildApp(testEnv(), { database: handle, logStream: logs });
  });

  afterEach(async () => {
    await app.close();
  });

  it("keeps a duplicate email out of the logs but logs the SQLSTATE and constraint", async () => {
    const email = `${secret}@example.com`;
    await insertUser(handle.db, { email });
    app.register(async (scope) => {
      scope.post("/t/dup", async () => {
        await insertUser(scope.db, { email });
        return { ok: true };
      });
    });

    const response = await app.inject({ method: "POST", url: "/t/dup" });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain(secret);
    expect(logs.text).not.toContain(secret);
    expect(logs.text).toContain("23505");
    expect(logs.text).toContain("users_email_unique");
    expect(logs.text).toContain("Failed query: insert into");
  });

  it("keeps a failing row out of the logs on a check violation", async () => {
    // Upper case breaks users_email_lowercase. Postgres puts the whole row into `detail`.
    const email = `${secret.toUpperCase()}@EXAMPLE.COM`;
    app.register(async (scope) => {
      scope.post("/t/check", async () => {
        await scope.db.insert(users).values({ email, passwordHash: `hash-${secret}` });
        return { ok: true };
      });
    });

    const response = await app.inject({ method: "POST", url: "/t/check" });

    expect(response.statusCode).toBe(500);
    expect(logs.text.toLowerCase()).not.toContain(secret);
    expect(logs.text).toContain("23514");
    expect(logs.text).toContain("users_email_lowercase");
  });

  it("keeps a bad value out of the logs on a data exception", async () => {
    // The message of a class 22 error quotes the value: invalid input syntax for type uuid: "..."
    app.register(async (scope) => {
      scope.get("/t/uuid", async () => {
        await scope.db.execute(sql`select ${secret}::uuid`);
        return { ok: true };
      });
    });

    const response = await app.inject({ method: "GET", url: "/t/uuid" });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain(secret);
    expect(logs.text).not.toContain(secret);
    expect(logs.text).toContain("22P02");
  });

  it("keeps a token hash out of the logs when an insert violates a foreign key", async () => {
    // Must satisfy the 64-hex CHECK so that the foreign key is what fails.
    const tokenHash = randomBytes(32).toString("hex");
    app.register(async (scope) => {
      scope.post("/t/fk", async () => {
        await scope.db.execute(
          sql`insert into refresh_sessions (user_id, family_id, token_hash, expires_at)
              values (uuidv7(), uuidv7(), ${tokenHash}, now() + interval '1 day')`,
        );
        return { ok: true };
      });
    });

    const response = await app.inject({ method: "POST", url: "/t/fk" });

    expect(response.statusCode).toBe(500);
    expect(logs.text).not.toContain(tokenHash);
    expect(logs.text).toContain("23503");
  });

  it("still serves requests after a failed query", async () => {
    app.register(async (scope) => {
      scope.get("/t/uuid", async () => {
        await scope.db.execute(sql`select ${secret}::uuid`);
        return { ok: true };
      });
    });
    await app.inject({ method: "GET", url: "/t/uuid" });
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
  });
});
