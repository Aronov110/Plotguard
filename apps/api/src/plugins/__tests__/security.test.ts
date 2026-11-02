import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/test-app.ts";

const ALLOWED = "https://app.example.com";

function build(env: Record<string, string> = {}): FastifyInstance {
  return buildTestApp({
    env: { CORS_ORIGINS: `${ALLOWED},http://localhost:5173`, ...env },
    routes: (app) => {
      app.get("/t/ping", async () => ({ pong: true }));
      app.get("/t/boom", async () => {
        throw new Error("boom");
      });
    },
  });
}

describe("security headers (helmet)", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it("sets the key headers on a normal response", async () => {
    app = build();
    const { headers } = await app.inject({ method: "GET", url: "/t/ping" });
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["strict-transport-security"]).toMatch(/max-age=\d+/);
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  it("denies everything in the content security policy", async () => {
    app = build();
    const { headers } = await app.inject({ method: "GET", url: "/t/ping" });
    const csp = String(headers["content-security-policy"]);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-inline");
  });

  it.each([
    ["404 responses", "/nope"],
    ["500 responses", "/t/boom"],
  ])("also sets them on %s", async (_label, url) => {
    app = build();
    const { headers } = await app.inject({ method: "GET", url });
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["content-security-policy"]).toContain("default-src 'none'");
  });
});

describe("CORS allowlist", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it("allows a listed origin and enables credentials", async () => {
    app = build();
    const { headers } = await app.inject({
      method: "GET",
      url: "/t/ping",
      headers: { origin: ALLOWED },
    });
    expect(headers["access-control-allow-origin"]).toBe(ALLOWED);
    expect(headers["access-control-allow-credentials"]).toBe("true");
    expect(String(headers.vary)).toContain("Origin");
  });

  it("allows each listed origin", async () => {
    app = build();
    const { headers } = await app.inject({
      method: "GET",
      url: "/t/ping",
      headers: { origin: "http://localhost:5173" },
    });
    expect(headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

  it.each([
    ["an unlisted origin", "https://evil.example.com"],
    ["a look-alike prefix", "https://app.example.com.evil.com"],
    ["a look-alike suffix", "https://evilapp.example.com"],
    ["a different scheme", "http://app.example.com"],
    ["a different port", "https://app.example.com:8443"],
    ["the null origin", "null"],
  ])("does not allow %s", async (_label, origin) => {
    app = build();
    const { headers } = await app.inject({ method: "GET", url: "/t/ping", headers: { origin } });
    // Without Access-Control-Allow-Origin a browser blocks the response. @fastify/cors still
    // echoes its static Allow-Credentials value, which grants nothing on its own.
    expect(headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("sends no CORS headers without an Origin header", async () => {
    app = build();
    const { headers } = await app.inject({ method: "GET", url: "/t/ping" });
    expect(headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("never answers with a wildcard", async () => {
    app = build();
    for (const origin of [ALLOWED, "https://evil.example.com"]) {
      const { headers } = await app.inject({ method: "GET", url: "/t/ping", headers: { origin } });
      expect(headers["access-control-allow-origin"]).not.toBe("*");
    }
  });

  it("answers a preflight from a listed origin", async () => {
    app = build();
    const response = await app.inject({
      method: "OPTIONS",
      url: "/t/ping",
      headers: {
        origin: ALLOWED,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,authorization",
      },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(ALLOWED);
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
    expect(String(response.headers["access-control-allow-headers"]).toLowerCase()).toContain(
      "authorization",
    );
    expect(response.headers["access-control-max-age"]).toBe("600");
  });

  it("does not approve a preflight from an unlisted origin", async () => {
    app = build();
    const response = await app.inject({
      method: "OPTIONS",
      url: "/t/ping",
      headers: { origin: "https://evil.example.com", "access-control-request-method": "POST" },
    });
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("rate limiting", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it("allows requests up to the limit and then answers 429 Problem Details", async () => {
    app = build({ RATE_LIMIT_MAX: "3", RATE_LIMIT_WINDOW_SECONDS: "60" });
    for (let i = 0; i < 3; i++) {
      const ok = await app.inject({ method: "GET", url: "/t/ping" });
      expect(ok.statusCode).toBe(200);
    }
    const limited = await app.inject({ method: "GET", url: "/t/ping" });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(limited.json()).toMatchObject({
      type: "urn:plotpal:problem:rate-limited",
      status: 429,
    });
    const retryAfter = Number(limited.headers["retry-after"]);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it("reports the remaining budget on allowed responses", async () => {
    app = build({ RATE_LIMIT_MAX: "5" });
    const response = await app.inject({ method: "GET", url: "/t/ping" });
    expect(response.headers["x-ratelimit-limit"]).toBe("5");
    expect(response.headers["x-ratelimit-remaining"]).toBe("4");
  });

  it("keeps a separate budget per client address", async () => {
    app = build({ RATE_LIMIT_MAX: "1" });
    const first = await app.inject({ method: "GET", url: "/t/ping", remoteAddress: "10.0.0.1" });
    const second = await app.inject({ method: "GET", url: "/t/ping", remoteAddress: "10.0.0.2" });
    const firstAgain = await app.inject({
      method: "GET",
      url: "/t/ping",
      remoteAddress: "10.0.0.1",
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(firstAgain.statusCode).toBe(429);
  });

  it("cannot be bypassed with a spoofed X-Forwarded-For header", async () => {
    app = build({ RATE_LIMIT_MAX: "1" });
    const first = await app.inject({
      method: "GET",
      url: "/t/ping",
      headers: { "x-forwarded-for": "1.1.1.1" },
    });
    const second = await app.inject({
      method: "GET",
      url: "/t/ping",
      headers: { "x-forwarded-for": "2.2.2.2" },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
  });

  it("also counts requests for unknown routes", async () => {
    app = build({ RATE_LIMIT_MAX: "2" });
    await app.inject({ method: "GET", url: "/nope" });
    await app.inject({ method: "GET", url: "/nope" });
    const limited = await app.inject({ method: "GET", url: "/nope" });
    expect(limited.statusCode).toBe(429);
  });
});
