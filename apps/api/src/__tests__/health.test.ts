import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.ts";
import { loadEnv } from "../config/env.ts";

const env = loadEnv({
  NODE_ENV: "test",
  DATABASE_URL: "postgres://user:pass@127.0.0.1:5432/db",
});

describe("GET /health", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp(env);
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns 200 and an ok status", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("returns 404 for unknown routes", async () => {
    const response = await app.inject({ method: "GET", url: "/nope" });
    expect(response.statusCode).toBe(404);
  });

  it("does not allow POST on /health", async () => {
    const response = await app.inject({ method: "POST", url: "/health" });
    expect(response.statusCode).toBe(404);
  });
});
