import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import type { Env } from "../config/env.ts";
import { RateLimitError } from "../errors/app-error.ts";
import { notFoundHandler } from "../errors/error-handler.ts";

/**
 * Registers security headers, the CORS allowlist and the global rate limit.
 * Call before registering routes so the hooks apply to all of them.
 *
 * The API only serves JSON, so the Content-Security-Policy forbids everything. The docs page
 * relaxes it for itself (see `registerOpenApi`).
 */
export function registerSecurity(app: FastifyInstance, env: Env): void {
  app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  });

  app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_SECONDS * 1000,
    // The store is in memory, so limits are per process. A shared store comes with scaling out.
    errorResponseBuilder: (_request, context) => new RateLimitError(context.ttl / 1000),
  });

  // Runs once the rate-limit plugin has loaded, because `app.rateLimit()` is added by it, and
  // before CORS is registered, so the hook below runs before CORS answers preflights.
  app.after((error) => {
    if (error) throw error;
    const limit = app.rateLimit();

    // The global limiter is a route-level hook, and @fastify/cors (an app-level hook) answers
    // preflights itself and ends the request, so preflights would never be counted. Count them
    // here. The limiter marks a request as counted, so nothing is counted twice.
    app.addHook("onRequest", async (request, reply) => {
      if (request.method === "OPTIONS") await limit.call(app, request, reply);
    });

    // Unknown URLs are rate limited too, so attackers cannot probe for valid routes at will.
    app.setNotFoundHandler({ preHandler: limit }, notFoundHandler);
  });

  app.register(cors, {
    // Exact-match allowlist. Never a wildcard: credentials are enabled.
    origin: [...env.CORS_ORIGINS],
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
    maxAge: 600,
  });
}
