import { describe, expect, it } from "vitest";
import { loadEnv } from "../../config/env.ts";
import {
  CHARACTERS_PER_TOKEN_OPTIMISTIC,
  CHARACTERS_PER_TOKEN_PESSIMISTIC,
  estimateRun,
  OUTPUT_TOKENS_PLANNED_MAX,
  OUTPUT_TOKENS_TYPICAL,
  PROMPT_OVERHEAD_TOKENS,
} from "../estimate.ts";
import { aiConfigFromEnv, DEFAULT_AI_WRITE_RULE, USAGE_WINDOW_HOURS } from "../limits.ts";
import { costUsd, priceOf } from "../pricing.ts";
import { testAiConfig } from "../test-support/config.ts";

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://user:pass@127.0.0.1:5432/db",
  JWT_ACCESS_SECRET: "test-only-secret-never-use-outside-tests-0123456789",
};

describe("aiConfigFromEnv", () => {
  it("carries the defaults of the environment over, with the timeout in milliseconds", () => {
    expect(aiConfigFromEnv(loadEnv(baseEnv))).toEqual({
      model: "claude-opus-5-5",
      effort: "high",
      maxInputTokens: 200_000,
      maxOutputTokens: 24_000,
      userDailyRuns: 10,
      userDailyTokens: 1_000_000,
      globalDailyTokens: 5_000_000,
      requestTimeoutMs: 600_000,
      writes: DEFAULT_AI_WRITE_RULE,
    });
  });

  it("carries changed settings over", () => {
    const config = aiConfigFromEnv(
      loadEnv({
        ...baseEnv,
        AI_MODEL: "claude-sonnet-5-5",
        AI_EFFORT: "medium",
        AI_MAX_INPUT_TOKENS: "50000",
        AI_USER_DAILY_RUNS: "3",
        AI_REQUEST_TIMEOUT_SECONDS: "90",
      }),
    );
    expect(config).toMatchObject({
      model: "claude-sonnet-5-5",
      effort: "medium",
      maxInputTokens: 50_000,
      userDailyRuns: 3,
      requestTimeoutMs: 90_000,
    });
  });

  it("has a usage window of one day", () => {
    expect(USAGE_WINDOW_HOURS).toBe(24);
  });
});

describe("priceOf and costUsd", () => {
  it.each([
    ["claude-opus-5-5", 4, 20],
    ["claude-sonnet-5-5", 2, 10],
    ["claude-haiku-5-5", 0.1, 0.5],
    ["claude-fable-5-1", 10, 50],
  ])("knows the price of %s", (model, input, output) => {
    expect(priceOf(model)).toEqual({ inputPerMillion: input, outputPerMillion: output });
  });

  it("has no price for a model it does not know, whatever it is called", () => {
    expect(priceOf("claude-unknown-9")).toBeUndefined();
    expect(priceOf("constructor")).toBeUndefined();
    expect(priceOf("__proto__")).toBeUndefined();
    expect(priceOf("")).toBeUndefined();
  });

  it("works out dollars from tokens", () => {
    // 30,000 tokens in at $4 per million and 4,000 out at $20 per million.
    expect(costUsd("claude-opus-5-5", 30_000, 4_000)).toBeCloseTo(0.2, 10);
    expect(costUsd("claude-sonnet-5-5", 1_000_000, 1_000_000)).toBe(12);
    expect(costUsd("claude-opus-5-5", 0, 0)).toBe(0);
  });

  it("gives nothing for an unknown model", () => {
    expect(costUsd("claude-unknown-9", 1000, 1000)).toBeUndefined();
  });
});

describe("estimateRun", () => {
  const config = testAiConfig();

  it("gives a range of input tokens from the character count, plus the instructions", () => {
    const estimate = estimateRun(100_000, config);
    expect(estimate.characters).toBe(100_000);
    expect(estimate.inputTokens).toEqual({
      low: Math.ceil(100_000 / CHARACTERS_PER_TOKEN_OPTIMISTIC) + PROMPT_OVERHEAD_TOKENS,
      high: Math.ceil(100_000 / CHARACTERS_PER_TOKEN_PESSIMISTIC) + PROMPT_OVERHEAD_TOKENS,
    });
    expect(estimate.inputTokens.low).toBeLessThan(estimate.inputTokens.high);
  });

  it("plans for a typical answer and for a long one, never past the output cap", () => {
    expect(estimateRun(1000, config).outputTokens).toEqual({
      low: OUTPUT_TOKENS_TYPICAL,
      high: OUTPUT_TOKENS_PLANNED_MAX,
    });
    expect(estimateRun(1000, testAiConfig({ maxOutputTokens: 5000 })).outputTokens).toEqual({
      low: OUTPUT_TOKENS_TYPICAL,
      high: 5000,
    });
    expect(estimateRun(1000, testAiConfig({ maxOutputTokens: 4000 })).outputTokens).toEqual({
      low: 4000,
      high: 4000,
    });
  });

  it("prices the range with the configured model: a 100-page screenplay is about 30 cents", () => {
    // About 100,000 characters.
    const estimate = estimateRun(100_000, config);
    expect(estimate.costUsd).toBeDefined();
    expect(estimate.costUsd?.low).toBeGreaterThan(0.1);
    expect(estimate.costUsd?.high).toBeLessThan(1.2);
    expect(estimate.costUsd?.low).toBeLessThan(estimate.costUsd?.high ?? 0);
  });

  it("costs half as much on the cheaper model", () => {
    const opus = estimateRun(100_000, config).costUsd;
    const sonnet = estimateRun(100_000, testAiConfig({ model: "claude-sonnet-5-5" })).costUsd;
    expect(sonnet?.low).toBeCloseTo((opus?.low ?? 0) / 2, 10);
    expect(sonnet?.high).toBeCloseTo((opus?.high ?? 0) / 2, 10);
  });

  it("gives no cost for a model without a known price, and still the tokens", () => {
    const estimate = estimateRun(100_000, testAiConfig({ model: "claude-unknown-9" }));
    expect(estimate.costUsd).toBeUndefined();
    expect(estimate.inputTokens.high).toBeGreaterThan(0);
  });

  it("says whether even the pessimistic estimate fits the limit", () => {
    const limit = testAiConfig({ maxInputTokens: 10_000 });
    // 10,000 tokens pessimistically is 8,500 tokens of text, about 21,250 characters.
    expect(estimateRun(21_000, limit).fits).toBe(true);
    expect(estimateRun(21_300, limit).fits).toBe(false);
    expect(estimateRun(1_000_000, limit).fits).toBe(false);
  });

  it("handles an empty text, and clamps nonsense", () => {
    expect(estimateRun(0, config).inputTokens).toEqual({
      low: PROMPT_OVERHEAD_TOKENS,
      high: PROMPT_OVERHEAD_TOKENS,
    });
    expect(estimateRun(-5, config).characters).toBe(0);
    expect(estimateRun(12.9, config).characters).toBe(12);
  });
});
