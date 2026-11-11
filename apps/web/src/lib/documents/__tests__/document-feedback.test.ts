import { describe, expect, it } from "vitest";
import { ApiError, NetworkError, ResponseShapeError } from "../../api/problem.ts";
import {
  classifySaveError,
  describeAddItemError,
  describeLoadError,
} from "../document-feedback.ts";

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

describe("classifySaveError", () => {
  it("calls a 412 a conflict", () => {
    expect(classifySaveError(apiError(412))).toEqual({ kind: "conflict" });
  });

  it("calls a 404 gone", () => {
    expect(classifySaveError(apiError(404))).toEqual({ kind: "gone" });
  });

  it("explains a 400 with the API's own words for the text", () => {
    const problem = classifySaveError(
      apiError(400, {
        issues: [
          { pointer: "/title", message: "Not about the text." },
          { pointer: "/content", message: "The text contains an invalid character." },
        ],
      }),
    );
    expect(problem).toEqual({
      kind: "invalid",
      message: "The text contains an invalid character.",
    });
  });

  it("explains a 400 that does not name the text with a fixed sentence", () => {
    const problem = classifySaveError(apiError(400));
    expect(problem.kind).toBe("invalid");
    expect(JSON.stringify(problem)).not.toContain("technical detail");
  });

  it("explains a 413 (a body that is too big)", () => {
    const problem = classifySaveError(apiError(413));
    expect(problem).toMatchObject({ kind: "invalid" });
    expect((problem as { message: string }).message).toContain("200,000");
  });

  it("waits as long as the API says after a 429", () => {
    expect(classifySaveError(apiError(429, { retryAfterSeconds: 12 }))).toEqual({
      kind: "retry",
      message: "Too many saves in a short time. Trying again in 12 seconds.",
      waitSeconds: 12,
    });
    expect(classifySaveError(apiError(429, { retryAfterSeconds: 1 }))).toMatchObject({
      message: "Too many saves in a short time. Trying again in 1 second.",
    });
  });

  it("still retries after a 429 that does not say how long", () => {
    expect(classifySaveError(apiError(429))).toEqual({
      kind: "retry",
      message: "Too many saves in a short time. Trying again soon.",
      waitSeconds: undefined,
    });
  });

  it("says that the text is still there when there is no connection", () => {
    const problem = classifySaveError(new NetworkError());
    expect(problem).toMatchObject({ kind: "retry", waitSeconds: undefined });
    expect((problem as { message: string }).message).toContain("Your text is still here");
  });

  it.each([502, 503, 504])("retries after a %d, saying the text is still there", (status) => {
    const problem = classifySaveError(apiError(status));
    expect(problem).toMatchObject({ kind: "retry" });
    expect((problem as { message: string }).message).toContain("still here");
  });

  it("tells the writer to log in again after a 401, and keeps the text", () => {
    const problem = classifySaveError(apiError(401));
    expect(problem).toMatchObject({ kind: "retry" });
    expect((problem as { message: string }).message).toContain("log in again");
    expect((problem as { message: string }).message).toContain("text is still here");
  });

  it.each([
    ["a 500", apiError(500)],
    ["a 428", apiError(428)],
    ["a wrong-shaped answer", new ResponseShapeError("bad shape with SECRET")],
    ["a plain error", new Error("SECRET")],
    ["something that is not an error", "SECRET"],
  ])(
    "retries with a general sentence after %s, never showing its technical text",
    (_name, error) => {
      const problem = classifySaveError(error);
      expect(problem).toMatchObject({ kind: "retry" });
      expect(JSON.stringify(problem)).not.toContain("SECRET");
      expect(JSON.stringify(problem)).not.toContain("technical detail");
    },
  );
});

describe("describeAddItemError", () => {
  it("puts the title's message under the title", () => {
    expect(
      describeAddItemError(
        apiError(400, { issues: [{ pointer: "/title", message: "The title is too long." }] }),
      ),
    ).toEqual({ title: "The title is too long.", general: [] });
  });

  it("keeps the first message for the title and lists the others as general", () => {
    expect(
      describeAddItemError(
        apiError(400, {
          issues: [
            { pointer: "/title", message: "First." },
            { pointer: "/title", message: "Second." },
            { pointer: "/parentId", message: "The parent does not exist in this project." },
          ],
        }),
      ),
    ).toEqual({ title: "First.", general: ["The parent does not exist in this project."] });
  });

  it("asks to check the input when a 400 names nothing", () => {
    expect(describeAddItemError(apiError(400))).toEqual({
      title: undefined,
      general: ["Please check what you entered and try again."],
    });
  });

  it("says that the outline is full after a 409", () => {
    expect(describeAddItemError(apiError(409)).general).toEqual([
      "The outline is full: a project can have at most 1,000 items.",
    ]);
  });

  it("says that the project no longer exists after a 404", () => {
    expect(describeAddItemError(apiError(404)).general).toEqual(["This project no longer exists."]);
  });

  it("says how long to wait after a 429, in the words of changes", () => {
    expect(describeAddItemError(apiError(429, { retryAfterSeconds: 5 })).general).toEqual([
      "Too many changes in a short time. Trying again in 5 seconds.",
    ]);
  });

  it("says that the server cannot be reached", () => {
    expect(describeAddItemError(new NetworkError()).general[0]).toContain("Can't reach the server");
  });

  it.each([
    ["a 500", apiError(500)],
    ["a wrong-shaped answer", new ResponseShapeError("SECRET")],
    ["a plain error", new Error("SECRET")],
  ])("gives one general sentence for %s", (_name, error) => {
    const problem = describeAddItemError(error);
    expect(problem.general).toEqual(["Something went wrong. Please try again."]);
    expect(JSON.stringify(problem)).not.toContain("SECRET");
  });
});

describe("describeLoadError", () => {
  it("says that the server cannot be reached", () => {
    expect(describeLoadError(new NetworkError(), "outline")).toContain("Can't reach the server");
  });

  it("says that a project or document is not there after a 404", () => {
    expect(describeLoadError(apiError(404), "project")).toBe(
      "This project does not exist, or it is not yours.",
    );
    expect(describeLoadError(apiError(404), "text")).toBe("This document does not exist any more.");
  });

  it("says how long to wait after a 429, and when the service is busy", () => {
    expect(describeLoadError(apiError(429, { retryAfterSeconds: 3 }), "outline")).toBe(
      "Too many requests in a short time. Trying again in 3 seconds.",
    );
    expect(describeLoadError(apiError(503), "outline")).toBe(
      "The service is busy. Try again in a moment.",
    );
  });

  it.each(["outline", "text", "project"] as const)(
    "gives a general sentence naming the %s for anything else",
    (what) => {
      expect(describeLoadError(apiError(500), what)).toBe(
        `The ${what} could not be loaded. Please try again.`,
      );
      expect(describeLoadError(new Error("SECRET"), what)).not.toContain("SECRET");
    },
  );
});
