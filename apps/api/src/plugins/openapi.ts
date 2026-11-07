import swagger from "@fastify/swagger";
import scalar from "@scalar/fastify-api-reference";
import type { FastifyInstance } from "fastify";
import { jsonSchemaTransform } from "fastify-type-provider-zod";

export const DOCS_PATH = "/docs";

/**
 * The docs page is the only HTML the API serves, so it gets its own, narrowly relaxed policy:
 * same-origin resources plus the inline script and styles the Scalar viewer needs.
 */
const DOCS_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * Generates the OpenAPI document from the routes' Zod schemas and serves it with Scalar at `/docs`.
 * Call before registering routes so every route is collected.
 */
export function registerOpenApi(app: FastifyInstance): void {
  app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Plotpal API",
        description:
          "Backend for Plotpal, an app that helps writers find plot holes and get ideas.",
        version: "0.0.0",
      },
      tags: [
        { name: "system", description: "Operational endpoints" },
        {
          name: "auth",
          description:
            "Sign-up, sign-in and sessions. Errors are Problem Details (RFC 9457) with the " +
            "content type `application/problem+json`: 400 invalid input, 401 not signed in or " +
            "wrong credentials, 403 wrong origin or CSRF code, 409 email taken, 413 body too " +
            "large, 415 not JSON, 429 too many requests (see `Retry-After`).",
        },
        {
          name: "projects",
          description:
            "The signed-in person's own projects (a screenplay, a novel, ...). Every route needs " +
            "the access token. A project of someone else is answered with 404, like one that " +
            "does not exist. Errors are Problem Details: 400 invalid input or cursor, 401 not " +
            "signed in, 404 no such project, 413 body too large, 415 not JSON, 429 too many " +
            "changes (see `Retry-After`).",
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description: "The access token from sign-up, login or refresh. Valid for 15 minutes.",
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  app.register(async (scope) => {
    scope.addHook("onSend", async (_request, reply) => {
      reply.header("content-security-policy", DOCS_CSP);
    });
    await scope.register(scalar, { routePrefix: DOCS_PATH });
  });
}
