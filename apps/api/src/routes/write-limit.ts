import type { CreateRateLimitOptions } from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RateRule } from "../auth/limits.ts";
import { RateLimitError } from "../errors/app-error.ts";
import { RATE_LIMIT_CACHE_SIZE } from "../plugins/security.ts";

/**
 * Makes a `preValidation` hook that counts one request against the signed-in person's own counter
 * and throws 429 past the maximum. Run it after `requireAuth`: the per-address limiter runs before
 * the login check and knows only addresses, so the per-person counter is called by hand.
 *
 * @param name Names the counter, so different areas do not share one.
 */
export function createWriteLimit(
  app: FastifyInstance,
  name: string,
  rule: RateRule,
): (request: FastifyRequest) => Promise<void> {
  // `cache` (how many people the counter remembers) is honoured by the plugin but missing from its
  // type for this call, so the options are built apart from the call. Left at its default of 5,000,
  // junk accounts could push a victim's counter out and reset it (see `rule` in routes/auth.ts).
  const options: CreateRateLimitOptions & { readonly cache: number } = {
    max: rule.max,
    timeWindow: rule.windowSeconds * 1000,
    cache: RATE_LIMIT_CACHE_SIZE,
    keyGenerator: (request: FastifyRequest) => `${name}:${request.userId ?? request.ip}`,
  };
  const counter = app.createRateLimit(options);

  return async (request) => {
    const state = await counter(request);
    // `isAllowed` is true only for allow-listed callers (there are none); a counted request always
    // has it false, and `isExceeded` says whether this one went past the maximum.
    if (!state.isAllowed && state.isExceeded) throw new RateLimitError(state.ttlInSeconds);
  };
}
