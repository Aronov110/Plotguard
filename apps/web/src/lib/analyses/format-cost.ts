import type { Estimate } from "../api/analyses-api.ts";

/** Dollars with two decimals; anything under a cent is shown as such instead of as $0.00. */
function dollars(amount: number): string {
  if (amount > 0 && amount < 0.01) return "under $0.01";
  return `$${amount.toFixed(2)}`;
}

/**
 * The cost of a run in words, as a range ("about $0.09 to $0.33"). The numbers are a rough estimate,
 * and the sentence says so. A model without a known price gets a sentence that says that instead.
 */
export function describeCost(estimate: Estimate): string {
  if (estimate.costUsd === null) return "The cost of this model is not known.";
  const { low, high } = estimate.costUsd;
  const lowText = dollars(low);
  const highText = dollars(high);
  if (lowText === highText) return `Costs about ${highText}.`;
  return `Costs about ${lowText} to ${highText}.`;
}

/** What is left of the writer's allowance, in words. */
export function describeAllowance(remaining: Estimate["remaining"]): string {
  const runs = Math.max(0, remaining.runs);
  return `You have ${runs} ${runs === 1 ? "AI request" : "AI requests"} left in the last 24 hours.`;
}

/** The size of the text in words that mean something to a writer. */
export function describeSize(characters: number): string {
  if (characters <= 0) return "There is no text yet.";
  const pages = characters / 1800;
  if (pages < 1) return "Less than a page of text.";
  const rounded = Math.round(pages);
  return `About ${rounded.toLocaleString("en-US")} ${rounded === 1 ? "page" : "pages"} of text.`;
}
