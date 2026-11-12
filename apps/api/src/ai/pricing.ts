/** What a model costs, in US dollars per million tokens. */
export interface ModelPrice {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
}

/**
 * The prices of the current models (Anthropic's published first-party rates). They are only used for
 * the cost hint shown before a run, never for billing, so a price that changes only makes the hint a
 * little off. A model that is not listed gets no price, and the hint then says so.
 */
const PRICES: Readonly<Record<string, ModelPrice>> = {
  "claude-fable-5-1": { inputPerMillion: 10, outputPerMillion: 50 },
  "claude-fable-5": { inputPerMillion: 10, outputPerMillion: 50 },
  "claude-opus-5-5": { inputPerMillion: 4, outputPerMillion: 20 },
  "claude-opus-5": { inputPerMillion: 5, outputPerMillion: 25 },
  "claude-opus-4-8": { inputPerMillion: 5, outputPerMillion: 25 },
  "claude-opus-4-7": { inputPerMillion: 5, outputPerMillion: 25 },
  "claude-opus-4-6": { inputPerMillion: 5, outputPerMillion: 25 },
  "claude-sonnet-5-5": { inputPerMillion: 2, outputPerMillion: 10 },
  "claude-sonnet-5": { inputPerMillion: 2, outputPerMillion: 10 },
  "claude-sonnet-4-6": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-haiku-5-5": { inputPerMillion: 0.1, outputPerMillion: 0.5 },
  "claude-haiku-4-5": { inputPerMillion: 1, outputPerMillion: 5 },
};

export function priceOf(model: string): ModelPrice | undefined {
  return Object.hasOwn(PRICES, model) ? PRICES[model] : undefined;
}

/** The cost in dollars of a number of input and output tokens, or `undefined` for an unknown model. */
export function costUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  const price = priceOf(model);
  if (price === undefined) return undefined;
  return (inputTokens * price.inputPerMillion + outputTokens * price.outputPerMillion) / 1_000_000;
}
