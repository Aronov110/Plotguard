import type { Writable } from "node:stream";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { Env } from "./config/env.ts";
import { buildLoggerOptions } from "./config/logger.ts";
import type { Database, DatabaseHandle } from "./db/client.ts";
import { frameworkErrorHandler, registerErrorHandling } from "./errors/error-handler.ts";
import { registerOpenApi } from "./plugins/openapi.ts";
import { registerSecurity } from "./plugins/security.ts";
import { healthRoutes } from "./routes/health.ts";

declare module "fastify" {
  interface FastifyInstance {
    /** Drizzle database instance. Its pool is closed when the app closes. */
    db: Database;
  }
}

/** Largest accepted request body. Fastify's default, made explicit. */
const BODY_LIMIT_BYTES = 1_048_576;

export interface AppDependencies {
  /** The app takes ownership: `app.close()` ends the pool. */
  readonly database: DatabaseHandle;
  /** Receives log output. Used by tests to assert on what is (not) logged. */
  readonly logStream?: Writable;
}

/** Builds the Fastify app without listening, so tests can use `app.inject()`. */
export function buildApp(env: Env, deps: AppDependencies): FastifyInstance {
  const app = Fastify({
    logger: buildLoggerOptions(env, deps.logStream),
    bodyLimit: BODY_LIMIT_BYTES,
    frameworkErrors: frameworkErrorHandler,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

  // text/plain is a CORS-safelisted content type, so a cross-site page can send it without a
  // preflight. The API speaks JSON only: anything else is answered with 415.
  app.removeContentTypeParser("text/plain");

  app.decorate("db", deps.database.db);
  app.addHook("onClose", async () => {
    await deps.database.close();
  });

  // Order matters. The rate limit attaches to routes through an onRoute hook, and a child scope
  // keeps only the hooks that existed when it was created. So security comes first, which makes
  // the docs routes (registered by OpenAPI) rate limited too. Both come before the routes.
  registerSecurity(app, env);
  registerOpenApi(app);

  app.register(healthRoutes);

  return app;
}
