import { Writable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildTestApp, testEnv } from "../../test-support/test-app.ts";
import { buildLoggerOptions } from "../logger.ts";

class LogCollector extends Writable {
  readonly lines: string[] = [];

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void {
    this.lines.push(...chunk.toString().split("\n").filter(Boolean));
    callback();
  }

  get text(): string {
    return this.lines.join("\n");
  }

  get entries(): Record<string, unknown>[] {
    return this.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  }
}

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
