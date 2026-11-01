import Fastify, { type FastifyInstance } from "fastify";
import type { Env } from "./config/env.ts";
import { healthRoutes } from "./routes/health.ts";

/** Builds the Fastify app without listening, so tests can use `app.inject()`. */
export function buildApp(env: Env): FastifyInstance {
  const app = Fastify({
    logger: env.NODE_ENV === "test" ? false : { level: "info" },
  });

  app.register(healthRoutes);

  return app;
}
