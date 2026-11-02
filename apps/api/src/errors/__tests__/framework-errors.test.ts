import { Writable } from "node:stream";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { buildTestApp } from "../../test-support/test-app.ts";

const silentLog = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

function build(): FastifyInstance {
  return buildTestApp({
    logStream: silentLog,
    routes: (app) => {
      const typed = app.withTypeProvider<ZodTypeProvider>();
      app.post("/t/free", async () => ({ ok: true }));
      typed.post("/t/json", { schema: { body: z.object({ a: z.string() }) } }, async () => ({
        ok: true,
      }));
      typed.get(
        "/t/params/:id",
        { schema: { params: z.object({ id: z.string() }) } },
        async () => ({ ok: true }),
      );
    },
  });
}

const PROBLEM = /^application\/problem\+json/;

describe("errors raised before routing", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it.each([
    ["an invalid percent escape", "/%zz"],
    ["a truncated percent escape", "/%E0%A4%A"],
    ["a lone percent sign", "/%"],
    ["an invalid escape in the middle of a path", "/t/params/ab%zzcd"],
  ])("returns Problem Details for %s", async (_label, url) => {
    app = build();
    const response = await app.inject({ method: "GET", url });
    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toMatch(PROBLEM);
    expect(response.json()).toMatchObject({
      type: "urn:plotpal:problem:http-400",
      title: "Bad Request",
      status: 400,
      detail: "The request URL is malformed.",
    });
  });

  it("sets nosniff itself, because helmet has not run yet", async () => {
    app = build();
    const response = await app.inject({ method: "GET", url: "/%zz" });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("does not reflect the invalid path or add an instance", async () => {
    app = build();
    const response = await app.inject({ method: "GET", url: "/%zz-REFLECTED" });
    expect(response.body).not.toContain("REFLECTED");
    expect(response.body).not.toContain("%zz");
    expect(response.json()).not.toHaveProperty("instance");
  });

  it("returns Problem Details for an over-long path parameter", async () => {
    app = build();
    const response = await app.inject({ method: "GET", url: `/t/params/${"a".repeat(500)}` });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
    expect(response.headers["content-type"]).toMatch(PROBLEM);
    expect(response.body).not.toContain("aaaaaaaaaa");
  });

  it("still answers a normal request after a malformed one", async () => {
    app = build();
    await app.inject({ method: "GET", url: "/%zz" });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
  });
});

describe("content types", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it.each(["/t/free", "/t/json"])("rejects text/plain on %s with 415", async (url) => {
    app = build();
    const response = await app.inject({
      method: "POST",
      url,
      headers: { "content-type": "text/plain" },
      payload: "hello",
    });
    expect(response.statusCode).toBe(415);
    expect(response.headers["content-type"]).toMatch(PROBLEM);
    expect(response.json().detail).toBe("Unsupported content type.");
  });

  it("rejects text/plain with a charset too", async () => {
    app = build();
    const response = await app.inject({
      method: "POST",
      url: "/t/free",
      headers: { "content-type": "text/plain; charset=utf-8" },
      payload: "hello",
    });
    expect(response.statusCode).toBe(415);
  });

  it.each([
    "application/x-www-form-urlencoded",
    "multipart/form-data; boundary=x",
    "application/xml",
  ])("rejects %s with 415", async (type) => {
    app = build();
    const response = await app.inject({
      method: "POST",
      url: "/t/free",
      headers: { "content-type": type },
      payload: "a=b",
    });
    expect(response.statusCode).toBe(415);
  });

  it.each(["application/json", "application/json; charset=utf-8"])("accepts %s", async (type) => {
    app = build();
    const response = await app.inject({
      method: "POST",
      url: "/t/json",
      headers: { "content-type": type },
      payload: JSON.stringify({ a: "x" }),
    });
    expect(response.statusCode).toBe(200);
  });

  it("accepts a POST with no body and no content type", async () => {
    app = build();
    const response = await app.inject({ method: "POST", url: "/t/free" });
    expect(response.statusCode).toBe(200);
  });

  it("accepts a POST with no body and a JSON content type on a route without a schema", async () => {
    app = build();
    const response = await app.inject({
      method: "POST",
      url: "/t/free",
      headers: { "content-type": "application/json" },
      payload: "{}",
    });
    expect(response.statusCode).toBe(200);
  });
});

describe("instance length", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it("caps a very long path at 200 characters", async () => {
    app = build();
    const response = await app.inject({ method: "GET", url: `/${"a".repeat(5000)}` });
    expect(response.statusCode).toBe(404);
    const { instance } = response.json<{ instance: string }>();
    expect(instance.length).toBeLessThanOrEqual(200);
    expect(instance.startsWith("/aaaa")).toBe(true);
    expect(instance.endsWith("…")).toBe(true);
  });

  it("leaves a short path untouched", async () => {
    app = build();
    const response = await app.inject({ method: "GET", url: "/short-path" });
    expect(response.json().instance).toBe("/short-path");
  });

  it("leaves a path of exactly 200 characters untouched", async () => {
    app = build();
    const path = `/${"b".repeat(199)}`;
    const response = await app.inject({ method: "GET", url: path });
    expect(response.json().instance).toBe(path);
  });
});
