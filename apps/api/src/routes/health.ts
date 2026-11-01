import type { FastifyInstance } from "fastify";

/** Liveness endpoint used by Docker healthchecks and monitoring. */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ status: "ok" as const }));
}
