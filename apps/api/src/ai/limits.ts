import type { RateRule } from "../auth/limits.ts";
import type { Env } from "../config/env.ts";

/** How the AI features behave: the model, how much it may read and write, and the limits. */
export interface AiConfig {
  readonly model: string;
  readonly effort: "low" | "medium" | "high" | "xhigh" | "max";
  /** The longest text one run may send, in tokens (estimated, pessimistically). */
  readonly maxInputTokens: number;
  /** The most the model may write in one run, thinking included. */
  readonly maxOutputTokens: number;
  /** One person's runs and tokens over the last {@link USAGE_WINDOW_HOURS} hours. */
  readonly userDailyRuns: number;
  readonly userDailyTokens: number;
  /** Everybody's tokens over the last {@link USAGE_WINDOW_HOURS} hours: the cap on the bill. */
  readonly globalDailyTokens: number;
  /** How long one run may take before it is given up. */
  readonly requestTimeoutMs: number;
  /** Starting, cancelling and deleting runs, per person. Separate from the other counters. */
  readonly writes: RateRule;
}

/** The "day" of the daily limits: a sliding window, so there is no midnight reset to game. */
export const USAGE_WINDOW_HOURS = 24;

/** Starting a run costs real money, so asking again and again is slowed down as well. */
export const DEFAULT_AI_WRITE_RULE: RateRule = { max: 20, windowSeconds: 60 };

export function aiConfigFromEnv(env: Env): AiConfig {
  return {
    model: env.AI_MODEL,
    effort: env.AI_EFFORT,
    maxInputTokens: env.AI_MAX_INPUT_TOKENS,
    maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
    userDailyRuns: env.AI_USER_DAILY_RUNS,
    userDailyTokens: env.AI_USER_DAILY_TOKENS,
    globalDailyTokens: env.AI_GLOBAL_DAILY_TOKENS,
    requestTimeoutMs: env.AI_REQUEST_TIMEOUT_SECONDS * 1000,
    writes: DEFAULT_AI_WRITE_RULE,
  };
}
