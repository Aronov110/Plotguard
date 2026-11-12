import type { AiConfig } from "./limits.ts";
import { costUsd } from "./pricing.ts";

/**
 * How many characters one token covers. English prose is about four; the newest models count up to a
 * third more tokens for the same text, and other languages and screenplay layout can need more still.
 * The estimate therefore gives a range: an optimistic end and a pessimistic one.
 */
export const CHARACTERS_PER_TOKEN_OPTIMISTIC = 4;
export const CHARACTERS_PER_TOKEN_PESSIMISTIC = 2.5;

/** The instructions and the delimiters around the text. */
export const PROMPT_OVERHEAD_TOKENS = 1500;

/** A typical answer (some findings and the thinking behind them), and the most to plan for. */
export const OUTPUT_TOKENS_TYPICAL = 4000;
export const OUTPUT_TOKENS_PLANNED_MAX = 16_000;

export interface Range {
  readonly low: number;
  readonly high: number;
}

export interface RunEstimate {
  readonly characters: number;
  readonly inputTokens: Range;
  readonly outputTokens: Range;
  /** In US dollars; `undefined` when the model has no known price. */
  readonly costUsd: Range | undefined;
  /** Whether even the pessimistic estimate fits the limit for one run. */
  readonly fits: boolean;
}

/**
 * A rough estimate of what one run on `characters` characters of text will use and cost. It needs no
 * call to the API and no text, only a character count, so it can be asked for as often as needed.
 */
export function estimateRun(characters: number, config: AiConfig): RunEstimate {
  const safeCharacters = Math.max(0, Math.floor(characters));
  const inputTokens: Range = {
    low: Math.ceil(safeCharacters / CHARACTERS_PER_TOKEN_OPTIMISTIC) + PROMPT_OVERHEAD_TOKENS,
    high: Math.ceil(safeCharacters / CHARACTERS_PER_TOKEN_PESSIMISTIC) + PROMPT_OVERHEAD_TOKENS,
  };
  const outputTokens: Range = {
    low: Math.min(OUTPUT_TOKENS_TYPICAL, config.maxOutputTokens),
    high: Math.min(OUTPUT_TOKENS_PLANNED_MAX, config.maxOutputTokens),
  };
  const low = costUsd(config.model, inputTokens.low, outputTokens.low);
  const high = costUsd(config.model, inputTokens.high, outputTokens.high);
  return {
    characters: safeCharacters,
    inputTokens,
    outputTokens,
    costUsd: low === undefined || high === undefined ? undefined : { low, high },
    fits: inputTokens.high <= config.maxInputTokens,
  };
}
