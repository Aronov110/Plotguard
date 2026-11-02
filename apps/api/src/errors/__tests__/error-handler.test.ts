import { Writable } from "node:stream";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { buildTestApp } from "../../test-support/test-app.ts";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from "../app-error.ts";

const SECRET = "hunter2-super-secret";

/** Swallows log output so deliberately failing routes do not spam the test run. */
const silentLog = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

function build(env: Record<string, string> = {}): FastifyInstance {
  return buildTestApp({
    env,
    logStream: silentLog,
    routes: (app) => {
      const typed = app.withTypeProvider<ZodTypeProvider>();

      app.get("/t/conflict", async () => {
        throw new ConflictError("That email is already registered.");
      });
      app.get("/t/unauthorized", async () => {
        throw new UnauthorizedError();
      });
      app.get("/t/forbidden", async () => {
        throw new ForbiddenError();
      });
      app.get("/t/not-found", async () => {
        throw new NotFoundError("No such project.");
      });
      app.get("/t/rate", async () => {
        throw new RateLimitError(12);
      });
      app.get("/t/validation", async () => {
        throw new ValidationError([{ source: "body", pointer: "/title", message: "Required" }]);
      });
      app.get("/t/boom", async () => {
        throw new Error(`connection to postgres://admin:${SECRET}@db failed`);
      });
      app.get("/t/boom-string", async () => {
        throw `raw string ${SECRET}`;
      });
      app.get("/t/boom-null", async () => {
        throw null;
      });
      app.get("/t/boom-status", async () => {
        throw Object.assign(new Error(`upstream said ${SECRET}`), { statusCode: 503 });
      });
      app.get("/t/boom-odd-status", async () => {
        throw Object.assign(new Error("odd"), { statusCode: 999 });
      });
      app.get("/t/boom-4xx", async () => {
        throw Object.assign(new Error(`bad thing ${SECRET}`), { statusCode: 418 });
      });

      typed.post(
        "/t/validated",
        {
          schema: {
            body: z.object({
              email: z.email(),
              age: z.number().int().min(18),
              role: z.enum(["writer", "editor"]),
              nested: z.object({ name: z.string().min(2) }),
            }),
          },
        },
        async () => ({ ok: true }),
      );
      typed.get(
        "/t/query",
        { schema: { querystring: z.object({ limit: z.coerce.number().int().min(1).max(100) }) } },
        async () => ({ ok: true }),
      );
      typed.get("/t/params/:id", { schema: { params: z.object({ id: z.uuid() }) } }, async () => ({
        ok: true,
      }));
      typed.post("/t/json", { schema: { body: z.object({ a: z.string() }) } }, async () => ({
        ok: true,
      }));
    },
  });
}

describe("global error handler", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  describe("AppError", () => {
    it.each([
      ["/t/conflict", 409, "conflict", "That email is already registered."],
      ["/t/unauthorized", 401, "unauthorized", "Authentication is required."],
      ["/t/forbidden", 403, "forbidden", "You are not allowed to do that."],
      ["/t/not-found", 404, "not-found", "No such project."],
    ])("%s becomes Problem Details", async (url, status, code, detail) => {
      app = build();
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(status);
      expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
      expect(response.json()).toMatchObject({
        type: `urn:plotpal:problem:${code}`,
        status,
        detail,
        instance: url,
      });
      expect(response.json().title).toEqual(expect.any(String));
    });

    it("sends WWW-Authenticate on 401", async () => {
      app = build();
      const response = await app.inject({ method: "GET", url: "/t/unauthorized" });
      expect(response.headers["www-authenticate"]).toBe("Bearer");
    });

    it("sends Retry-After on 429", async () => {
      app = build();
      const response = await app.inject({ method: "GET", url: "/t/rate" });
      expect(response.statusCode).toBe(429);
      expect(response.headers["retry-after"]).toBe("12");
    });

    it("includes validation issues", async () => {
      app = build();
      const response = await app.inject({ method: "GET", url: "/t/validation" });
      expect(response.json().errors).toEqual([
        { source: "body", pointer: "/title", message: "Required" },
      ]);
    });

    it("leaves the query string out of instance", async () => {
      app = build();
      const response = await app.inject({
        method: "GET",
        url: `/t/conflict?token=${SECRET}`,
      });
      expect(response.json().instance).toBe("/t/conflict");
      expect(response.body).not.toContain(SECRET);
    });
  });

  describe("unexpected errors", () => {
    it.each(["/t/boom", "/t/boom-string", "/t/boom-null"])(
      "%s gives a generic 500 without leaking details",
      async (url) => {
        app = build();
        const response = await app.inject({ method: "GET", url });
        expect(response.statusCode).toBe(500);
        expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
        expect(response.json()).toEqual({
          type: "urn:plotpal:problem:internal-error",
          title: "Internal Server Error",
          status: 500,
          detail: "An unexpected error occurred.",
          instance: url,
        });
        expect(response.body).not.toContain(SECRET);
        expect(response.body).not.toContain("postgres://");
        expect(response.body).not.toContain("at ");
      },
    );

    it("keeps a 5xx status from a library error but hides its message", async () => {
      app = build();
      const response = await app.inject({ method: "GET", url: "/t/boom-status" });
      expect(response.statusCode).toBe(503);
      expect(response.json().detail).toBe("An unexpected error occurred.");
      expect(response.body).not.toContain(SECRET);
    });

    it("falls back to 500 for an out-of-range status code", async () => {
      app = build();
      const response = await app.inject({ method: "GET", url: "/t/boom-odd-status" });
      expect(response.statusCode).toBe(500);
    });

    it("keeps a 4xx status from a library error but hides its message", async () => {
      app = build();
      const response = await app.inject({ method: "GET", url: "/t/boom-4xx" });
      expect(response.statusCode).toBe(418);
      expect(response.json().type).toBe("urn:plotpal:problem:http-418");
      expect(response.body).not.toContain(SECRET);
    });

    it("hides details in production too", async () => {
      app = build({ NODE_ENV: "production", CORS_ORIGINS: "https://app.example.com" });
      const response = await app.inject({ method: "GET", url: "/t/boom" });
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain(SECRET);
    });
  });

  describe("request validation", () => {
    const valid = {
      email: "writer@example.com",
      age: 30,
      role: "writer",
      nested: { name: "Ann" },
    };

    it("accepts a valid body", async () => {
      app = build();
      const response = await app.inject({ method: "POST", url: "/t/validated", payload: valid });
      expect(response.statusCode).toBe(200);
    });

    it("returns every invalid field with a JSON pointer", async () => {
      app = build();
      const response = await app.inject({
        method: "POST",
        url: "/t/validated",
        payload: { email: "nope", age: 3, role: "admin", nested: { name: "A" } },
      });
      expect(response.statusCode).toBe(400);
      expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
      const body = response.json();
      expect(body.type).toBe("urn:plotpal:problem:validation-error");
      expect(body.errors).toHaveLength(4);
      const pointers = body.errors.map((e: { pointer: string }) => e.pointer).sort();
      expect(pointers).toEqual(["/age", "/email", "/nested/name", "/role"]);
      for (const issue of body.errors) {
        expect(issue.source).toBe("body");
        expect(issue.message).toEqual(expect.any(String));
      }
    });

    it("never echoes submitted values", async () => {
      app = build();
      const response = await app.inject({
        method: "POST",
        url: "/t/validated",
        payload: { ...valid, email: SECRET, role: SECRET },
      });
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain(SECRET);
    });

    it("rejects a missing body", async () => {
      app = build();
      const response = await app.inject({ method: "POST", url: "/t/validated" });
      expect(response.statusCode).toBe(400);
      expect(response.json().type).toBe("urn:plotpal:problem:validation-error");
    });

    it("rejects wrong types", async () => {
      app = build();
      const response = await app.inject({
        method: "POST",
        url: "/t/validated",
        payload: { ...valid, age: "thirty" },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().errors[0].pointer).toBe("/age");
    });

    it("reports the querystring as the source", async () => {
      app = build();
      const response = await app.inject({ method: "GET", url: "/t/query?limit=0" });
      expect(response.statusCode).toBe(400);
      expect(response.json().errors[0]).toMatchObject({ source: "querystring", pointer: "/limit" });
    });

    it("reports route params as the source", async () => {
      app = build();
      const response = await app.inject({ method: "GET", url: "/t/params/not-a-uuid" });
      expect(response.statusCode).toBe(400);
      expect(response.json().errors[0]).toMatchObject({ source: "params", pointer: "/id" });
    });
  });

  describe("protocol-level errors", () => {
    it("returns 404 Problem Details for unknown routes", async () => {
      app = build();
      const response = await app.inject({ method: "GET", url: "/nope" });
      expect(response.statusCode).toBe(404);
      expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
      expect(response.json()).toMatchObject({
        type: "urn:plotpal:problem:not-found",
        status: 404,
        instance: "/nope",
      });
    });

    it("returns 400 for malformed JSON without echoing it", async () => {
      app = build();
      const response = await app.inject({
        method: "POST",
        url: "/t/json",
        headers: { "content-type": "application/json" },
        payload: `{"a": "${SECRET}", `,
      });
      expect(response.statusCode).toBe(400);
      expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
      expect(response.body).not.toContain(SECRET);
    });

    it("returns 415 for an unsupported content type", async () => {
      app = build();
      const response = await app.inject({
        method: "POST",
        url: "/t/json",
        // Fastify parses text/plain natively, so use a type that has no parser.
        headers: { "content-type": "application/xml" },
        payload: "<a/>",
      });
      expect(response.statusCode).toBe(415);
      expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
      expect(response.json().detail).toBe("Unsupported content type.");
    });

    it("returns 413 for an oversized body", async () => {
      app = build();
      const response = await app.inject({
        method: "POST",
        url: "/t/json",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ a: "x".repeat(1_048_577) }),
      });
      expect(response.statusCode).toBe(413);
      expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
      expect(response.json().detail).toBe("The request body is too large.");
    });
  });
});
