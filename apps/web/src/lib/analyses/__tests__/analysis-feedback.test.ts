import { describe, expect, it } from "vitest";
import { ApiError, NetworkError } from "../../api/problem.ts";
import {
  categoryLabel,
  describeReadError,
  describeRunFailure,
  describeStartError,
  describeWait,
  severityLabel,
  severityWord,
} from "../analysis-feedback.ts";

function apiError(
  status: number,
  code?: string,
  extra: { retryAfterSeconds?: number; detail?: string } = {},
): ApiError {
  return new ApiError({
    status,
    code,
    detail: extra.detail,
    issues: [],
    retryAfterSeconds: extra.retryAfterSeconds,
  });
}

describe("describeWait", () => {
  it.each([
    [1, "1 second"],
    [30, "30 seconds"],
    [59, "59 seconds"],
    [60, "1 minute"],
    [61, "2 minutes"],
    [3000, "50 minutes"],
    [3540, "59 minutes"],
    [3599, "1 hour"],
    [3600, "1 hour"],
    [3601, "2 hours"],
    [7200, "2 hours"],
  ])("says %i seconds as %s", (seconds, words) => {
    expect(describeWait(seconds)).toBe(words);
  });

  it("never says zero, and rounds a fraction up", () => {
    expect(describeWait(0)).toBe("1 second");
    expect(describeWait(-5)).toBe("1 second");
    expect(describeWait(0.2)).toBe("1 second");
    expect(describeWait(1.2)).toBe("2 seconds");
  });
});

describe("describeStartError", () => {
  it("treats a run already going as a case of its own", () => {
    expect(describeStartError(apiError(409, "run-in-progress"))).toEqual({
      kind: "already-running",
    });
  });

  it("says when there is no text, and what to do", () => {
    const problem = describeStartError(apiError(422, "manuscript-empty"));
    expect(problem).toMatchObject({ kind: "problem" });
    expect(problem).toHaveProperty("message", expect.stringContaining("Write something first"));
  });

  it("suggests a smaller part when the text is too long", () => {
    expect(describeStartError(apiError(413, "manuscript-too-large"))).toMatchObject({
      message: expect.stringContaining("single act or scene"),
    });
  });

  it("tells when the used-up allowance will be back", () => {
    const problem = describeStartError(
      apiError(429, "ai-daily-limit", { retryAfterSeconds: 1800 }),
    );
    expect(problem).toMatchObject({
      kind: "problem",
      message: expect.stringContaining("Try again in 30 minutes."),
    });
  });

  it("still helps when the allowance answer has no wait time", () => {
    expect(describeStartError(apiError(429, "ai-daily-limit"))).toMatchObject({
      message: expect.stringContaining("Try again later."),
    });
  });

  it("words the per-minute limit differently from the daily one", () => {
    const problem = describeStartError(
      apiError(429, "too-many-requests", { retryAfterSeconds: 20 }),
    );
    expect(problem).toMatchObject({
      message: expect.stringContaining(
        "Too many requests in a short time. Try again in 20 seconds.",
      ),
    });
  });

  it("says the feature is off, as something that will not change by itself", () => {
    expect(describeStartError(apiError(503, "ai-unavailable"))).toMatchObject({
      kind: "unavailable",
      message: expect.stringContaining("not switched on"),
    });
  });

  it("says the day's budget is used up, in a different sentence", () => {
    expect(describeStartError(apiError(503, "ai-budget-reached"))).toMatchObject({
      kind: "unavailable",
      message: expect.stringContaining("budget"),
    });
  });

  it("explains a missing project or item, and an ended login", () => {
    expect(describeStartError(apiError(404, "not-found"))).toMatchObject({
      message: expect.stringContaining("no longer exists"),
    });
    expect(describeStartError(apiError(401))).toMatchObject({
      message: expect.stringContaining("log in again"),
    });
  });

  it("explains a lost connection", () => {
    expect(describeStartError(new NetworkError())).toMatchObject({
      message: expect.stringContaining("Can't reach the server"),
    });
  });

  it("gives a plain sentence for anything else and never shows the server's own text", () => {
    for (const error of [
      apiError(500, undefined, { detail: "SECRET stack trace" }),
      new Error("SECRET internal"),
      "SECRET",
    ]) {
      const problem = describeStartError(error);
      expect(problem).toMatchObject({ kind: "problem" });
      expect(JSON.stringify(problem)).not.toContain("SECRET");
    }
  });
});

describe("describeRunFailure", () => {
  const codes = [
    "refused",
    "truncated",
    "invalid_output",
    "rate_limited",
    "overloaded",
    "timeout",
    "too_long",
    "not_configured",
    "canceled",
    "interrupted",
    "internal",
  ];

  it.each(codes)("has its own sentence for %s", (code) => {
    const { message } = describeRunFailure(code);
    expect(message.length).toBeGreaterThan(10);
    expect(message).not.toContain(code);
  });

  it("gives every code a different sentence", () => {
    const messages = new Set(codes.map((code) => describeRunFailure(code).message));
    expect(messages.size).toBe(codes.length);
  });

  it("says plainly that a cancelled run was cancelled by the writer", () => {
    expect(describeRunFailure("canceled").message).toContain("You cancelled");
  });

  it("gives a plain sentence for a code it does not know, and for none", () => {
    expect(describeRunFailure("brand_new").message).toBe(describeRunFailure(null).message);
    expect(describeRunFailure("brand_new").message).not.toContain("brand_new");
  });

  it("is not fooled by names that exist on every object", () => {
    expect(describeRunFailure("constructor").message).toBe(describeRunFailure(null).message);
    expect(describeRunFailure("__proto__").message).toBe(describeRunFailure(null).message);
  });
});

describe("describeReadError", () => {
  it("names what could not be loaded", () => {
    expect(describeReadError(new Error("x"), "estimate")).toBe("Could not load the cost estimate.");
    expect(describeReadError(new Error("x"), "history")).toBe("Could not load your earlier scans.");
    expect(describeReadError(new Error("x"), "run")).toBe("Could not load the scan.");
  });

  it("explains a lost connection and a missing thing", () => {
    expect(describeReadError(new NetworkError(), "history")).toContain("Can't reach the server");
    expect(describeReadError(apiError(404), "run")).toBe("That scan no longer exists.");
    expect(describeReadError(apiError(404), "history")).toBe("This project no longer exists.");
  });

  it("tells how long to wait after too many requests", () => {
    expect(describeReadError(apiError(429, undefined, { retryAfterSeconds: 5 }), "run")).toContain(
      "Try again in 5 seconds.",
    );
  });
});

describe("categoryLabel", () => {
  it.each([
    ["continuity", "Continuity"],
    ["timeline", "Timeline"],
    ["motivation", "Motivation"],
    ["logic", "Logic"],
    ["setup_payoff", "Setup and payoff"],
    ["character", "Character"],
    ["world_rules", "World rules"],
    ["other", "Other"],
  ])("words %s as %s", (category, label) => {
    expect(categoryLabel(category)).toBe(label);
  });

  it("makes an unknown kind readable instead of showing it raw", () => {
    expect(categoryLabel("a_new_kind")).toBe("A new kind");
    expect(categoryLabel("some-other")).toBe("Some other");
  });

  it("falls back to Other for an empty one and is not fooled by inherited names", () => {
    expect(categoryLabel("")).toBe("Other");
    expect(categoryLabel("___")).toBe("Other");
    expect(categoryLabel("constructor")).toBe("Constructor");
  });
});

describe("severity words", () => {
  it("explains each level, so that colour is never the only signal", () => {
    expect(severityLabel("major")).toContain("breaks the story");
    expect(severityLabel("moderate")).toContain("careful reader");
    expect(severityLabel("minor")).toContain("small");
    expect(severityWord("major")).toBe("Major");
    expect(severityWord("minor")).toBe("Minor");
  });
});
