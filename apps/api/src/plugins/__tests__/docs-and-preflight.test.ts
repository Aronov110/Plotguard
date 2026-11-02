import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../../test-support/test-app.ts";

const ALLOWED = "https://app.example.com";
const EVIL = "https://evil.example.com";
const DOCS_URLS = ["/docs/", "/docs/openapi.json", "/docs/openapi.yaml"] as const;

function build(max: string): FastifyInstance {
  return buildTestApp({
    env: { CORS_ORIGINS: ALLOWED, RATE_LIMIT_MAX: max, RATE_LIMIT_WINDOW_SECONDS: "60" },
    routes: (app) => {
      app.get("/t/ping", async () => ({ pong: true }));
    },
  });
}

function preflight(app: FastifyInstance, ip: string, origin = ALLOWED) {
  return app.inject({
    method: "OPTIONS",
    url: "/t/ping",
    remoteAddress: ip,
    headers: { origin, "access-control-request-method": "POST" },
  });
}

describe("docs routes", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it.each(DOCS_URLS)("%s carries the baseline security headers", async (url) => {
    app = build("100");
    const { headers } = await app.inject({ method: "GET", url });
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["strict-transport-security"]).toMatch(/max-age=\d+/);
  });

  it.each(DOCS_URLS)("%s keeps the relaxed docs policy, not the deny-all one", async (url) => {
    app = build("100");
    const { headers } = await app.inject({ method: "GET", url });
    const csp = String(headers["content-security-policy"]);
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it.each(DOCS_URLS)("%s is rate limited", async (url) => {
    app = build("2");
    const ip = "10.20.0.1";
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await app.inject({ method: "GET", url, remoteAddress: ip })).statusCode);
    }
    expect(statuses).toEqual([200, 200, 429, 429]);
  });

  it("answers over-limit docs requests with Problem Details", async () => {
    app = build("1");
    await app.inject({ method: "GET", url: "/docs/openapi.json", remoteAddress: "10.20.0.2" });
    const limited = await app.inject({
      method: "GET",
      url: "/docs/openapi.json",
      remoteAddress: "10.20.0.2",
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThanOrEqual(1);
  });

  it("shares one budget between docs and API routes", async () => {
    app = build("2");
    const ip = "10.20.0.3";
    await app.inject({ method: "GET", url: "/docs/openapi.json", remoteAddress: ip });
    await app.inject({ method: "GET", url: "/t/ping", remoteAddress: ip });
    const third = await app.inject({ method: "GET", url: "/t/ping", remoteAddress: ip });
    expect(third.statusCode).toBe(429);
  });

  it("still documents the real routes", async () => {
    app = build("100");
    const spec = (await app.inject({ method: "GET", url: "/docs/openapi.json" })).json();
    expect(Object.keys(spec.paths)).toContain("/health");
    expect(Object.keys(spec.paths)).not.toContain("/t/ping".replace("/t", "/docs"));
  });

  it("keeps /health exempt from the limit", async () => {
    app = build("1");
    for (let i = 0; i < 5; i++) {
      const response = await app.inject({
        method: "GET",
        url: "/health",
        remoteAddress: "10.20.0.4",
      });
      expect(response.statusCode).toBe(200);
    }
  });
});

describe("CORS preflight rate limiting", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it("answers preflights under the limit with the CORS headers", async () => {
    app = build("3");
    const response = await preflight(app, "10.30.0.1");
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(ALLOWED);
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
    expect(response.headers["access-control-max-age"]).toBe("600");
  });

  it("answers a preflight over the limit with 429 Problem Details", async () => {
    app = build("3");
    const ip = "10.30.0.2";
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await preflight(app, ip)).statusCode);
    expect(statuses).toEqual([204, 204, 204, 429, 429]);

    const limited = await preflight(app, ip);
    expect(limited.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(limited.json()).toMatchObject({ type: "urn:plotpal:problem:rate-limited", status: 429 });
    expect(Number(limited.headers["retry-after"])).toBeGreaterThanOrEqual(1);
  });

  it("counts a preflight from an unlisted origin too", async () => {
    app = build("2");
    const ip = "10.30.0.3";
    expect((await preflight(app, ip, EVIL)).statusCode).not.toBe(429);
    expect((await preflight(app, ip, EVIL)).statusCode).not.toBe(429);
    expect((await preflight(app, ip, EVIL)).statusCode).toBe(429);
  });

  it("does not approve an unlisted origin while under the limit", async () => {
    app = build("5");
    const response = await preflight(app, "10.30.0.4", EVIL);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("shares one budget between preflights and real requests", async () => {
    app = build("3");
    const ip = "10.30.0.5";
    await preflight(app, ip);
    await app.inject({ method: "GET", url: "/t/ping", remoteAddress: ip });
    await preflight(app, ip);
    const next = await app.inject({ method: "GET", url: "/t/ping", remoteAddress: ip });
    expect(next.statusCode).toBe(429);
  });

  it("does not count a preflight twice", async () => {
    app = build("2");
    const ip = "10.30.0.6";
    const first = await preflight(app, ip);
    const second = await preflight(app, ip);
    expect([first.statusCode, second.statusCode]).toEqual([204, 204]);
  });

  it("keeps a separate budget per client address", async () => {
    app = build("1");
    expect((await preflight(app, "10.30.0.7")).statusCode).toBe(204);
    expect((await preflight(app, "10.30.0.8")).statusCode).toBe(204);
    expect((await preflight(app, "10.30.0.7")).statusCode).toBe(429);
  });

  it("does not let an X-Forwarded-For header dodge the preflight limit", async () => {
    app = build("1");
    const ip = "10.30.0.9";
    const send = (forwarded: string) =>
      app.inject({
        method: "OPTIONS",
        url: "/t/ping",
        remoteAddress: ip,
        headers: {
          origin: ALLOWED,
          "access-control-request-method": "POST",
          "x-forwarded-for": forwarded,
        },
      });
    expect((await send("1.1.1.1")).statusCode).toBe(204);
    expect((await send("2.2.2.2")).statusCode).toBe(429);
  });

  it("keeps CORS headers on an over-limit response to a normal request", async () => {
    app = build("1");
    const ip = "10.30.0.10";
    await app.inject({ method: "GET", url: "/t/ping", remoteAddress: ip });
    const limited = await app.inject({
      method: "GET",
      url: "/t/ping",
      remoteAddress: ip,
      headers: { origin: ALLOWED },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["access-control-allow-origin"]).toBe(ALLOWED);
  });
});
