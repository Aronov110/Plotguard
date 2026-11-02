import type { FastifyRequest } from "fastify";
import { ForbiddenError } from "../errors/app-error.ts";

/**
 * Builds a hook that only lets through requests whose `Origin` header is on the allowlist.
 *
 * Browsers add `Origin` to every cross-site POST and to same-site fetches too, and a web page
 * cannot change it. A missing header is refused as well: for the routes this protects, a real
 * browser always sends it, so only scripts and forged requests arrive without it.
 */
export function createOriginGuard(allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins);
  return async function originGuard(request: FastifyRequest): Promise<void> {
    const origin = request.headers.origin;
    if (typeof origin !== "string" || !allowed.has(origin)) {
      throw new ForbiddenError("The request does not come from an allowed origin.");
    }
  };
}
