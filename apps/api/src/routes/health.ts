import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

/** Liveness endpoint used by Docker healthchecks and monitoring. Exempt from rate limiting. */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.withTypeProvider<ZodTypeProvider>().get(
    "/health",
    {
      config: { rateLimit: false },
      schema: {
        tags: ["system"],
        summary: "Liveness probe",
        response: { 200: z.object({ status: z.literal("ok") }) },
      },
    },
    async () => ({ status: "ok" as const }),
  );
}
