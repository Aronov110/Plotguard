import type { z } from "zod";
import type { AiConfig } from "./limits.ts";

/** What one call to the model needs. The service builds it; the client only sends it. */
export interface AiRequest {
  /** The standing instructions. The same for every kind of run, so the API can cache them. */
  readonly system: string;
  /** The writer's text with its structure. The same for every kind of run on the same text. */
  readonly manuscript: string;
  /** What to do with it, for this kind of run. Sent last, so the cached part stays the same. */
  readonly task: string;
  /** The shape the answer must have. */
  readonly schema: z.ZodType;
  readonly model: AiConfig["model"];
  readonly effort: AiConfig["effort"];
  readonly maxOutputTokens: number;
}

/** What the API reports it used. */
export interface AiUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Read from the cache: cheaper. Not counted in `inputTokens`. */
  readonly cacheReadTokens: number;
  /** Written to the cache. Not counted in `inputTokens`. */
  readonly cacheWriteTokens: number;
}

export type AiOutcome =
  /** The model answered. `output` is what it said as JSON; the service checks its shape. */
  | { readonly kind: "ok"; readonly output: unknown; readonly usage: AiUsage }
  /** The model's safety systems declined, also after the fallback. */
  | { readonly kind: "refused"; readonly category: string | null; readonly usage: AiUsage }
  /** The answer hit the output limit and was cut off. */
  | { readonly kind: "truncated"; readonly usage: AiUsage }
  /** The answer was not JSON. */
  | { readonly kind: "unparseable"; readonly usage: AiUsage };

export type AiProviderErrorCode =
  | "rate_limited"
  | "overloaded"
  | "timeout"
  | "too_long"
  | "not_configured"
  | "canceled"
  | "unavailable";

/**
 * A call that failed in a way the service can name. The message never holds the text, the prompt or
 * the key, so it is safe to log.
 */
export class AiProviderError extends Error {
  readonly code: AiProviderErrorCode;

  constructor(code: AiProviderErrorCode, options: { readonly cause?: unknown } = {}) {
    super(`The AI request failed: ${code}.`, options.cause === undefined ? undefined : options);
    this.name = "AiProviderError";
    this.code = code;
  }
}

/** The one place the program talks to a model. Tests use a fake; the app uses Claude's. */
export interface AiClient {
  /**
   * Sends one request and waits for the whole answer.
   *
   * @param signal Aborting it stops the call; the call then fails with a `canceled` or `timeout`
   *   {@link AiProviderError} (the service knows which, because it knows who aborted).
   * @throws AiProviderError for anything that went wrong with the call itself.
   */
  run(request: AiRequest, signal: AbortSignal): Promise<AiOutcome>;
}
