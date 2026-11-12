import type { AiConfig } from "../limits.ts";

/** An AI configuration for tests: the real defaults, with limits high enough to stay out of the way. */
export function testAiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    model: "claude-opus-5-5",
    effort: "high",
    maxInputTokens: 200_000,
    maxOutputTokens: 24_000,
    userDailyRuns: 1000,
    userDailyTokens: 100_000_000,
    globalDailyTokens: 1_000_000_000,
    requestTimeoutMs: 60_000,
    writes: { max: 100_000, windowSeconds: 60 },
    ...overrides,
  };
}
