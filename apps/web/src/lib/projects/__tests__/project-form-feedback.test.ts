import { describe, expect, it } from "vitest";
import { ApiError, NetworkError, ResponseShapeError } from "../../api/problem.ts";
import {
  describeListError,
  describeProjectError,
  summaryItems,
  validateRequired,
} from "../project-form-feedback.ts";

function apiError(
  status: number,
  extra: { issues?: { pointer: string; message: string }[]; retryAfterSeconds?: number } = {},
): ApiError {
  return new ApiError({
    status,
    code: undefined,
    detail: "A technical detail that must never be shown.",
    issues: extra.issues ?? [],
    retryAfterSeconds: extra.retryAfterSeconds,
  });
}

describe("describeProjectError", () => {
  it("puts each field message under its field", () => {
    const feedback = describeProjectError(
      apiError(400, {
        issues: [
          { pointer: "/title", message: "The title is too long." },
          { pointer: "/format", message: "The format must be screenplay, prose or other." },
          { pointer: "/logline", message: "The logline is too long." },
        ],
      }),
    );
    expect(feedback.fieldErrors).toEqual({
      title: "The title is too long.",
      format: "The format must be screenplay, prose or other.",
      logline: "The logline is too long.",
    });
    expect(feedback.general).toEqual([]);
  });

  it("keeps the first message when a field has several", () => {
    const feedback = describeProjectError(
      apiError(400, {
        issues: [
          { pointer: "/title", message: "First." },
          { pointer: "/title", message: "Second." },
        ],
      }),
    );
    expect(feedback.fieldErrors).toEqual({ title: "First." });
  });

  it("lists a problem with an unknown field as a general one", () => {
    const feedback = describeProjectError(
      apiError(400, { issues: [{ pointer: "/something", message: "Unknown." }] }),
    );
    expect(feedback.fieldErrors).toEqual({});
    expect(feedback.general).toEqual(["Unknown."]);
  });

  it.each(["/__proto__", "/constructor", "/toString", "/hasOwnProperty"])(
    "never lets the pointer %s reach a built-in property",
    (pointer) => {
      const feedback = describeProjectError(
        apiError(400, { issues: [{ pointer, message: "No." }] }),
      );
      expect(feedback.fieldErrors).toEqual({});
      expect(feedback.general).toEqual(["No."]);
      expect(Object.getPrototypeOf(feedback.fieldErrors)).toBe(Object.prototype);
    },
  );

  it("asks the person to check their input when a 400 names nothing", () => {
    expect(describeProjectError(apiError(400)).general).toEqual([
      "Please check what you entered and try again.",
    ]);
  });

  it("says how long to wait after a 429", () => {
    expect(describeProjectError(apiError(429, { retryAfterSeconds: 12 })).general).toEqual([
      "Too many requests. Try again in 12 seconds.",
    ]);
    expect(describeProjectError(apiError(429, { retryAfterSeconds: 1 })).general).toEqual([
      "Too many requests. Try again in 1 second.",
    ]);
  });

  it("still helps when a 429 does not say how long to wait", () => {
    expect(describeProjectError(apiError(429)).general).toEqual([
      "Too many requests. Please wait a moment and try again.",
    ]);
  });

  it("says that the service is busy after a 503", () => {
    expect(describeProjectError(apiError(503)).general).toEqual([
      "The service is busy. Try again in a moment.",
    ]);
  });

  it("asks for a new login after a 401", () => {
    expect(describeProjectError(apiError(401)).general).toEqual([
      "Your login has ended. Please log in again.",
    ]);
  });

  it("says that the server cannot be reached when there was no answer", () => {
    expect(describeProjectError(new NetworkError()).general).toEqual([
      "Can't reach the server. Check your connection and try again.",
    ]);
  });

  it.each([
    ["a 500", apiError(500)],
    ["a 404", apiError(404)],
    ["a wrong-shaped answer", new ResponseShapeError("bad shape with SECRET")],
    ["a plain error", new Error("SECRET")],
    ["something that is not an error", "SECRET"],
  ])("gives one generic sentence for %s, never the technical text", (_name, error) => {
    const feedback = describeProjectError(error);
    expect(feedback.general).toEqual(["Something went wrong. Please try again."]);
    expect(JSON.stringify(feedback)).not.toContain("SECRET");
    expect(JSON.stringify(feedback)).not.toContain("technical detail");
  });
});

describe("describeListError", () => {
  it("says that the server cannot be reached", () => {
    expect(describeListError(new NetworkError())).toBe(
      "Can't reach the server. Check your connection and try again.",
    );
  });

  it("says how long to wait after a 429, and when the service is busy", () => {
    expect(describeListError(apiError(429, { retryAfterSeconds: 3 }))).toBe(
      "Too many requests. Try again in 3 seconds.",
    );
    expect(describeListError(apiError(503))).toBe("The service is busy. Try again in a moment.");
  });

  it.each([
    ["a 500", apiError(500)],
    ["a 401", apiError(401)],
    ["a wrong-shaped answer", new ResponseShapeError("SECRET")],
    ["nothing", undefined],
  ])("gives the general sentence for %s", (_name, error) => {
    const message = describeListError(error);
    expect(message).toBe("Your projects could not be loaded. Please try again.");
  });
});

describe("validateRequired", () => {
  it("accepts a title and a format", () => {
    expect(validateRequired({ title: "Lighthouse", format: "prose" })).toBeUndefined();
  });

  it.each(["", " ", "   ", "\t\n"])("asks for a title when it is %j", (title) => {
    expect(validateRequired({ title, format: "prose" })?.fieldErrors).toEqual({
      title: "Enter a title.",
    });
  });

  it("asks for a format when none is chosen", () => {
    expect(validateRequired({ title: "T", format: "" })?.fieldErrors).toEqual({
      format: "Choose a format.",
    });
  });

  it("reports both problems at once", () => {
    expect(validateRequired({ title: "", format: "" })?.fieldErrors).toEqual({
      title: "Enter a title.",
      format: "Choose a format.",
    });
  });

  it("leaves every other rule to the API: a very long title passes", () => {
    expect(validateRequired({ title: "x".repeat(5000), format: "other" })).toBeUndefined();
  });
});

describe("summaryItems", () => {
  const ids = { title: "t", format: "f", logline: "l" } as const;

  it("lists field problems in form order, each linked to its field, then the general ones", () => {
    const items = summaryItems(
      {
        fieldErrors: { logline: "L", title: "T", format: "F" },
        general: ["General one.", "General two."],
      },
      ids,
    );
    expect(items).toEqual([
      { message: "T", fieldId: "t" },
      { message: "F", fieldId: "f" },
      { message: "L", fieldId: "l" },
      { message: "General one." },
      { message: "General two." },
    ]);
  });

  it("is empty when nothing is wrong", () => {
    expect(summaryItems({ fieldErrors: {}, general: [] }, ids)).toEqual([]);
  });
});
