import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { buildTestApp } from "../../test-support/test-app.ts";

interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, Record<string, unknown>>>;
}

function build(): FastifyInstance {
  return buildTestApp({
    routes: (app) => {
      app.withTypeProvider<ZodTypeProvider>().post(
        "/t/things",
        {
          schema: {
            tags: ["test"],
            summary: "Create a thing",
            body: z.object({ title: z.string().min(1).max(200), note: z.string().optional() }),
            response: { 201: z.object({ id: z.uuid() }) },
          },
        },
        async (_request, reply) =>
          reply.status(201).send({ id: "0190a000-0000-7000-8000-000000000000" }),
      );
    },
  });
}

describe("OpenAPI document", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  async function loadSpec(): Promise<OpenApiDocument> {
    const response = await app.inject({ method: "GET", url: "/docs/openapi.json" });
    expect(response.statusCode).toBe(200);
    return response.json<OpenApiDocument>();
  }

  it("is OpenAPI 3.1 with API info", async () => {
    app = build();
    const spec = await loadSpec();
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("Plotpal API");
    expect(spec.info.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("documents /health with its response schema", async () => {
    app = build();
    const spec = await loadSpec();
    const health = spec.paths["/health"]?.get;
    expect(health).toBeDefined();
    expect(health?.tags).toEqual(["system"]);
    expect(JSON.stringify(health?.responses)).toContain('"ok"');
  });

  it("derives request and response schemas from Zod", async () => {
    app = build();
    const spec = await loadSpec();
    const operation = spec.paths["/t/things"]?.post;
    expect(operation).toBeDefined();
    const requestBody = JSON.stringify(operation?.requestBody);
    expect(requestBody).toContain('"title"');
    expect(requestBody).toContain('"maxLength":200');
    expect(requestBody).toContain('"required":["title"]');
    expect(JSON.stringify(operation?.responses)).toContain('"201"');
  });

  it("does not document the docs routes themselves", async () => {
    app = build();
    const spec = await loadSpec();
    expect(Object.keys(spec.paths).filter((path) => path.startsWith("/docs"))).toEqual([]);
  });
});

describe("docs page", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it("redirects /docs to /docs/", async () => {
    app = build();
    const response = await app.inject({ method: "GET", url: "/docs" });
    expect(response.statusCode).toBe(301);
    expect(response.headers.location).toBe("/docs/");
  });

  it("serves HTML at /docs/", async () => {
    app = build();
    const response = await app.inject({ method: "GET", url: "/docs/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^text\/html/);
  });

  it("loads no scripts from other origins", async () => {
    app = build();
    const response = await app.inject({ method: "GET", url: "/docs/" });
    expect(response.body).not.toMatch(/<script[^>]+src=["']https?:\/\//i);
  });

  it("relaxes the content security policy for /docs only", async () => {
    app = build();
    const docs = await app.inject({ method: "GET", url: "/docs/" });
    const docsCsp = String(docs.headers["content-security-policy"]);
    expect(docsCsp).toContain("script-src 'self' 'unsafe-inline'");
    expect(docsCsp).toContain("frame-ancestors 'none'");
    expect(docsCsp).not.toContain("*");

    const health = await app.inject({ method: "GET", url: "/health" });
    const healthCsp = String(health.headers["content-security-policy"]);
    expect(healthCsp).toContain("default-src 'none'");
    expect(healthCsp).not.toContain("unsafe-inline");
  });
});
