import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../test-support/test-app.ts";

describe("GET /health", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it("returns 200 and an ok status", async () => {
    app = buildTestApp();
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("returns 404 Problem Details for unknown routes", async () => {
    app = buildTestApp();
    const response = await app.inject({ method: "GET", url: "/nope" });
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
  });

  it("does not allow POST on /health", async () => {
    app = buildTestApp();
    const response = await app.inject({ method: "POST", url: "/health" });
    expect(response.statusCode).toBe(404);
  });

  it("is exempt from rate limiting so healthchecks never fail", async () => {
    app = buildTestApp({ env: { RATE_LIMIT_MAX: "2", RATE_LIMIT_WINDOW_SECONDS: "60" } });
    for (let i = 0; i < 10; i++) {
      const response = await app.inject({ method: "GET", url: "/health" });
      expect(response.statusCode).toBe(200);
    }
  });
});
