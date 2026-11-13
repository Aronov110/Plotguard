import { describe, expect, it } from "vitest";
import { makeEstimate } from "../../../test-support/analyses-handlers.ts";
import { describeAllowance, describeCost, describeSize } from "../format-cost.ts";

describe("describeCost", () => {
  it("gives a range, and calls it about", () => {
    expect(describeCost(makeEstimate({ costUsd: { low: 0.09, high: 0.33 } }))).toBe(
      "Costs about $0.09 to $0.33.",
    );
  });

  it("gives one number when both ends are the same", () => {
    expect(describeCost(makeEstimate({ costUsd: { low: 0.5, high: 0.5 } }))).toBe(
      "Costs about $0.50.",
    );
  });

  it("does not show a tiny cost as zero", () => {
    expect(describeCost(makeEstimate({ costUsd: { low: 0.004, high: 0.2 } }))).toBe(
      "Costs about under $0.01 to $0.20.",
    );
  });

  it("says when the model has no known price", () => {
    expect(describeCost(makeEstimate({ costUsd: null }))).toBe(
      "The cost of this model is not known.",
    );
  });
});

describe("describeAllowance", () => {
  it("says how many AI requests are left", () => {
    expect(describeAllowance({ runs: 10, tokens: 1 })).toBe(
      "You have 10 AI requests left in the last 24 hours.",
    );
    expect(describeAllowance({ runs: 1, tokens: 1 })).toBe(
      "You have 1 AI request left in the last 24 hours.",
    );
  });

  it("says none, never a negative number", () => {
    expect(describeAllowance({ runs: 0, tokens: 0 })).toContain("You have 0 AI requests left");
    expect(describeAllowance({ runs: -3, tokens: 0 })).toContain("You have 0 AI requests left");
  });
});

describe("describeSize", () => {
  it("says when there is no text", () => {
    expect(describeSize(0)).toBe("There is no text yet.");
  });

  it("says less than a page for a short text", () => {
    expect(describeSize(525)).toBe("Less than a page of text.");
  });

  it("counts pages of about 1,800 characters", () => {
    expect(describeSize(1800)).toBe("About 1 page of text.");
    expect(describeSize(180_000)).toBe("About 100 pages of text.");
    expect(describeSize(1_800_000)).toBe("About 1,000 pages of text.");
  });
});
