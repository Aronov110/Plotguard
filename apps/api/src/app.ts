import type { Writable } from "node:stream";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { Env } from "./config/env.ts";
import { buildLoggerOptions } from "./config/logger.ts";
import type { Database, DatabaseHandle } from "./db/client.ts";
import { registerErrorHandling } from "./errors/error-handler.ts";
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
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

  app.decorate("db", deps.database.db);
  app.addHook("onClose", async () => {
    await deps.database.close();
  });

  // Order matters: OpenAPI and the security hooks must exist before the routes are registered.
  registerOpenApi(app);
  registerSecurity(app, env);

  app.register(healthRoutes);

  return app;
}
