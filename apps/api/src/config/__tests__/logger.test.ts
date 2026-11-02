import { DrizzleQueryError } from "drizzle-orm/errors";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { LogCollector } from "../../test-support/log-collector.ts";
import { buildTestApp, testEnv } from "../../test-support/test-app.ts";
import { buildLoggerOptions } from "../logger.ts";

const BEARER = "Bearer eyJhbGciOiJIUzI1NiJ9.super-secret-access-token";
const COOKIE = "refresh_token=super-secret-refresh-token";
const CSRF = "super-secret-csrf-token";

describe("buildLoggerOptions", () => {
  it("is silent in tests unless a stream is given", () => {
    expect(buildLoggerOptions(testEnv())).toBe(false);
  });

  it("logs in development", () => {
    expect(buildLoggerOptions(testEnv({ NODE_ENV: "development" }))).toMatchObject({
      level: "info",
    });
  });

  it("logs when a stream is given, even in tests", () => {
    expect(buildLoggerOptions(testEnv(), new LogCollector())).toMatchObject({ level: "info" });
  });
});

describe("logging", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it("redacts credentials if they are ever logged", async () => {
    const logs = new LogCollector();
    app = buildTestApp({
      logStream: logs,
      routes: (scope) => {
        scope.get("/t/log-headers", async (request, reply) => {
          const sensitive = {
            authorization: request.headers.authorization,
            cookie: request.headers.cookie,
            "x-csrf-token": request.headers["x-csrf-token"],
            "set-cookie": COOKIE,
            accept: "application/json",
          };
          // Fastify's req/res serializers would already strip headers, so log under other keys.
          request.log.info(
            {
              headers: sensitive,
              upstream: { headers: sensitive },
              failure: { response: { headers: sensitive } },
            },
            "manual header dump",
          );
          return reply.send({ ok: true });
        });
      },
    });

    await app.inject({
      method: "GET",
      url: "/t/log-headers",
      headers: { authorization: BEARER, cookie: COOKIE, "x-csrf-token": CSRF },
    });

    expect(logs.text).toContain("manual header dump");
    expect(logs.text).toContain("[Redacted]");
    expect(logs.text).not.toContain("super-secret-access-token");
    expect(logs.text).not.toContain("super-secret-refresh-token");
    expect(logs.text).not.toContain(CSRF);
    // Non-sensitive headers stay readable.
    expect(logs.text).toContain("application/json");
  });

  it("does not log request credentials during normal request logging", async () => {
    const logs = new LogCollector();
    app = buildTestApp({ logStream: logs });
    await app.inject({
      method: "GET",
      url: "/health",
      headers: { authorization: BEARER, cookie: COOKIE },
    });
    expect(logs.text).not.toContain("super-secret");
  });

  it("logs unexpected errors in full on the server while the client gets a generic problem", async () => {
    const logs = new LogCollector();
    app = buildTestApp({
      logStream: logs,
      routes: (scope) => {
        scope.get("/t/boom", async () => {
          throw new Error("database exploded: relation users missing");
        });
      },
    });

    const response = await app.inject({ method: "GET", url: "/t/boom" });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("database exploded");
    const entry = logs.entries.find((line) => line.level === 50);
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry)).toContain("database exploded: relation users missing");
    expect(entry?.reqId).toEqual(expect.any(String));
  });

  it("does not log client errors as errors", async () => {
    const logs = new LogCollector();
    app = buildTestApp({ logStream: logs });
    await app.inject({ method: "GET", url: "/nope" });
    expect(logs.entries.some((line) => line.level === 50)).toBe(false);
  });
});

describe("extended redaction", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  const HEADER_NAMES = [
    "authorization",
    "Authorization",
    "cookie",
    "Cookie",
    "set-cookie",
    "Set-Cookie",
    "x-csrf-token",
    "X-CSRF-Token",
    "X-Csrf-Token",
    "proxy-authorization",
    "Proxy-Authorization",
    "x-api-key",
    "X-API-Key",
    "X-Api-Key",
    "api-key",
    "Api-Key",
    "x-auth-token",
    "X-Auth-Token",
  ];

  const BODY_FIELDS = [
    "password",
    "newPassword",
    "currentPassword",
    "passwordHash",
    "token",
    "accessToken",
    "refreshToken",
    "password_hash",
    "token_hash",
    "refresh_token",
    "access_token",
    "new_password",
    "current_password",
  ];

  /** Wraps `value` in `depth` levels of objects: depth 0 is the value itself. */
  function nest(depth: number, key: string, value: unknown): Record<string, unknown> {
    let result: Record<string, unknown> = { [key]: value };
    for (let i = 0; i < depth; i++) result = { wrapper: result };
    return result;
  }

  async function logObject(payload: Record<string, unknown>): Promise<string> {
    const logs = new LogCollector();
    app = buildTestApp({
      logStream: logs,
      routes: (scope) => {
        scope.get("/t/dump", async (request) => {
          request.log.info(payload, "dump");
          return { ok: true };
        });
      },
    });
    await app.inject({ method: "GET", url: "/t/dump" });
    return logs.text;
  }

  it.each(HEADER_NAMES.flatMap((name) => [0, 1, 2].map((depth) => [name, depth] as const)))(
    "redacts the %s header at depth %i",
    async (name, depth) => {
      const secret = `SECRET-${name}-${depth}`;
      const text = await logObject(nest(depth, "headers", { [name]: secret, accept: "text/html" }));
      expect(text).not.toContain(secret);
      expect(text).toContain("[Redacted]");
      expect(text).toContain("text/html");
    },
  );

  it.each(BODY_FIELDS.flatMap((field) => [0, 1, 2].map((depth) => [field, depth] as const)))(
    "redacts the %s field at depth %i",
    async (field, depth) => {
      const secret = `SECRET-${field}-${depth}`;
      const payload = nest(depth, field, secret);
      const text = await logObject({ ...payload, title: "My story" });
      expect(text).not.toContain(secret);
      expect(text).toContain("[Redacted]");
      expect(text).toContain("My story");
    },
  );

  it("leaves harmless fields readable", async () => {
    const text = await logObject({ headers: { accept: "application/json" }, title: "Plot" });
    expect(text).toContain("application/json");
    expect(text).toContain("Plot");
  });
});

describe("request logging", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it.each([
    ["a known route", "/health"],
    ["an unknown route", "/nope"],
  ])("never logs the query string of %s", async (_label, path) => {
    const logs = new LogCollector();
    app = buildTestApp({ logStream: logs });
    await app.inject({ method: "GET", url: `${path}?token=QUERY-SECRET&x=1` });
    expect(logs.text).not.toContain("QUERY-SECRET");
    expect(logs.text).not.toContain("token=");
    expect(logs.text).toContain(`"url":"${path}"`);
  });

  it("keeps method, host and remote address in the request log", async () => {
    const logs = new LogCollector();
    app = buildTestApp({ logStream: logs });
    await app.inject({ method: "GET", url: "/health", remoteAddress: "10.1.2.3" });
    const entry = logs.entries.find((line) => line.msg === "incoming request");
    expect(entry?.req).toMatchObject({ method: "GET", url: "/health", remoteAddress: "10.1.2.3" });
  });

  it("never logs the query string of a failing request", async () => {
    const logs = new LogCollector();
    app = buildTestApp({
      logStream: logs,
      routes: (scope) => {
        scope.get("/t/boom", async () => {
          throw new Error("boom");
        });
      },
    });
    await app.inject({ method: "GET", url: "/t/boom?token=QUERY-SECRET" });
    expect(logs.text).not.toContain("QUERY-SECRET");
  });
});

describe("error logging", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it("logs a failed query without its bound parameters", async () => {
    const logs = new LogCollector();
    app = buildTestApp({
      logStream: logs,
      routes: (scope) => {
        scope.get("/t/db-fail", async () => {
          throw new DrizzleQueryError(
            'insert into "users" ("email") values ($1)',
            ["PARAM-SECRET@example.com"],
            Object.assign(new Error("duplicate key value violates unique constraint"), {
              code: "23505",
              severity: "ERROR",
              constraint: "users_email_key",
              detail: "Key (email)=(PARAM-SECRET@example.com) already exists.",
            }),
          );
        });
      },
    });

    const response = await app.inject({ method: "GET", url: "/t/db-fail" });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("PARAM-SECRET");
    expect(logs.text).not.toContain("PARAM-SECRET");
    expect(logs.text).toContain("Failed query: insert into");
    expect(logs.text).toContain("23505");
    expect(logs.text).toContain("users_email_key");
  });
});
