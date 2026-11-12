import { describe, expect, it } from "vitest";
import { ApiError, NetworkError, ResponseShapeError } from "../../api/problem.ts";
import { describeBlockedAction, describeItemActionError } from "../document-feedback.ts";

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

describe("describeItemActionError", () => {
  it("says that the server cannot be reached, for all three actions", () => {
    for (const action of ["rename", "move", "delete"] as const) {
      expect(describeItemActionError(new NetworkError(), action)).toEqual({
        title: undefined,
        general: ["Can't reach the server. Check your connection and try again."],
      });
    }
  });

  it("gives a general sentence for a bug or a changed API, never its text", () => {
    expect(describeItemActionError(new ResponseShapeError("secret"), "rename")).toEqual({
      title: undefined,
      general: ["Something went wrong. Please try again."],
    });
    expect(describeItemActionError("nonsense", "move").general).toEqual([
      "Something went wrong. Please try again.",
    ]);
  });

  describe("a 400", () => {
    it("on a rename shows the API's words under the title", () => {
      const error = apiError(400, {
        issues: [{ pointer: "/title", message: "The title can be at most 200 characters." }],
      });
      expect(describeItemActionError(error, "rename")).toEqual({
        title: "The title can be at most 200 characters.",
        general: [],
      });
    });

    it("on a rename keeps the first title message and lists the others as general", () => {
      const error = apiError(400, {
        issues: [
          { pointer: "/title", message: "First." },
          { pointer: "/title", message: "Second." },
          { pointer: "/other", message: "Elsewhere." },
        ],
      });
      expect(describeItemActionError(error, "rename")).toEqual({
        title: "First.",
        general: ["Elsewhere."],
      });
    });

    it("on a rename with no details asks to check the title", () => {
      expect(describeItemActionError(apiError(400), "rename")).toEqual({
        title: undefined,
        general: ["Please check the new title and try again."],
      });
    });

    it("on a move says it is not possible, without the API's technical words", () => {
      const problem = describeItemActionError(apiError(400), "move");
      expect(problem.title).toBeUndefined();
      expect(problem.general).toEqual([
        "That is not possible here. Check the outline and try again.",
      ]);
    });
  });

  it("says that the item does not exist any more after a 404", () => {
    expect(describeItemActionError(apiError(404), "move").general).toEqual([
      "This item does not exist any more.",
    ]);
  });

  it("explains a 412 with what was not done, and where to decide", () => {
    expect(describeItemActionError(apiError(412), "rename").general[0]).toContain(
      "was not renamed",
    );
    expect(describeItemActionError(apiError(412), "move").general[0]).toContain("was not moved");
    expect(describeItemActionError(apiError(412), "delete").general[0]).toContain(
      "was not deleted",
    );
    expect(describeItemActionError(apiError(412), "rename").general[0]).toContain("notice");
  });

  it("says how long to wait after a 429, in the words of changes", () => {
    expect(
      describeItemActionError(apiError(429, { retryAfterSeconds: 12 }), "move").general,
    ).toEqual(["Too many changes in a short time. Trying again in 12 seconds."]);
    expect(
      describeItemActionError(apiError(429, { retryAfterSeconds: 1 }), "move").general,
    ).toEqual(["Too many changes in a short time. Trying again in 1 second."]);
    expect(describeItemActionError(apiError(429), "move").general).toEqual([
      "Too many changes in a short time. Trying again soon.",
    ]);
  });

  it("says that the service is busy after a 502, 503 or 504", () => {
    for (const status of [502, 503, 504]) {
      expect(describeItemActionError(apiError(status), "delete").general).toEqual([
        "The service is busy. Try again in a moment.",
      ]);
    }
  });

  it("never shows the technical detail", () => {
    for (const status of [400, 404, 412, 429, 500, 503]) {
      for (const action of ["rename", "move", "delete"] as const) {
        const problem = describeItemActionError(apiError(status), action);
        expect(JSON.stringify(problem)).not.toContain("technical detail");
      }
    }
  });
});

describe("describeBlockedAction", () => {
  it("says what was not done and where to decide, for a conflict", () => {
    expect(describeBlockedAction("conflict", "rename")).toContain("nothing was renamed");
    expect(describeBlockedAction("conflict", "move")).toContain("nothing was moved");
    expect(describeBlockedAction("conflict", "delete")).toContain("nothing was deleted");
    expect(describeBlockedAction("conflict", "move")).toContain("notice");
  });

  it("says that the item is gone", () => {
    expect(describeBlockedAction("gone", "rename")).toBe("This item does not exist any more.");
  });

  it("has a general sentence for the rare case that the writer already left", () => {
    expect(describeBlockedAction("left", "move")).toBe("Something went wrong. Please try again.");
  });
});
