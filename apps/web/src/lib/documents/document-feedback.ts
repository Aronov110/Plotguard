import { ApiError, NetworkError } from "../api/problem.ts";

/** What went wrong with a save, in the few kinds that need a different reaction. */
export type SaveProblem =
  /** Another tab or device saved a newer version first (412). */
  | { readonly kind: "conflict" }
  /** The document no longer exists (404). */
  | { readonly kind: "gone" }
  /** The text cannot be saved as it is (400, 413). It waits until the text changes. */
  | { readonly kind: "invalid"; readonly message: string }
  /** A passing problem: the same text is tried again later. */
  | { readonly kind: "retry"; readonly message: string; readonly waitSeconds: number | undefined };

const GENERIC = "The text could not be saved. Trying again soon.";

function tooManyRequests(seconds: number | undefined): string {
  if (seconds === undefined) return "Too many saves in a short time. Trying again soon.";
  return `Too many saves in a short time. Trying again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`;
}

/**
 * Sorts a failed save into the kinds above and finds the words for it. Only text written for people
 * is ever shown: the API's own message for the text field, and the fixed sentences here. The
 * technical `detail` of an error is never shown, and neither is the text of an unknown error.
 */
export function classifySaveError(error: unknown): SaveProblem {
  if (error instanceof NetworkError) {
    return {
      kind: "retry",
      message: "Can't reach the server. Your text is still here and will be saved when it is back.",
      waitSeconds: undefined,
    };
  }
  if (!(error instanceof ApiError)) {
    return { kind: "retry", message: GENERIC, waitSeconds: undefined };
  }

  switch (error.status) {
    case 412:
      return { kind: "conflict" };
    case 404:
      return { kind: "gone" };
    case 400: {
      const issue = error.issues.find((candidate) => candidate.pointer === "/content");
      return {
        kind: "invalid",
        message: issue?.message ?? "The text could not be saved. Check it for unusual characters.",
      };
    }
    case 413:
      return {
        kind: "invalid",
        message: "The text is too long to save. A document can hold at most 200,000 characters.",
      };
    case 429:
      return {
        kind: "retry",
        message: tooManyRequests(error.retryAfterSeconds),
        waitSeconds: error.retryAfterSeconds,
      };
    case 401:
      return {
        kind: "retry",
        message: "Your login has ended. Please log in again. Your text is still here.",
        waitSeconds: undefined,
      };
    case 502:
    case 503:
    case 504:
      return {
        kind: "retry",
        message: "The service is busy. Your text is still here and will be saved soon.",
        waitSeconds: undefined,
      };
    default:
      return { kind: "retry", message: GENERIC, waitSeconds: undefined };
  }
}

/** What the "add an item" form shows after something went wrong. */
export interface AddItemProblem {
  /** A message for the title field, when the API named the title. */
  readonly title: string | undefined;
  /** Messages that belong to no field. */
  readonly general: readonly string[];
}

/**
 * Turns a failed "add to the outline" into words. 400 messages come from the API per field; the
 * other kinds are fixed sentences.
 */
export function describeAddItemError(error: unknown): AddItemProblem {
  const general = (message: string): AddItemProblem => ({ title: undefined, general: [message] });

  if (error instanceof NetworkError) {
    return general("Can't reach the server. Check your connection and try again.");
  }
  if (!(error instanceof ApiError)) return general("Something went wrong. Please try again.");

  switch (error.status) {
    case 400: {
      let title: string | undefined;
      const other: string[] = [];
      for (const issue of error.issues) {
        if (issue.pointer === "/title") title ??= issue.message;
        else other.push(issue.message);
      }
      if (title === undefined && other.length === 0) {
        other.push("Please check what you entered and try again.");
      }
      return { title, general: other };
    }
    case 404:
      return general("This project no longer exists.");
    case 409:
      return general("The outline is full: a project can have at most 1,000 items.");
    case 429:
      return general(tooManyRequests(error.retryAfterSeconds).replace("saves", "changes"));
    case 503:
      return general("The service is busy. Try again in a moment.");
    default:
      return general("Something went wrong. Please try again.");
  }
}

/** The words for an outline or a document that could not be loaded. One sentence. */
export function describeLoadError(error: unknown, what: "outline" | "text" | "project"): string {
  if (error instanceof NetworkError) {
    return "Can't reach the server. Check your connection and try again.";
  }
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return what === "text"
        ? "This document does not exist any more."
        : "This project does not exist, or it is not yours.";
    }
    if (error.status === 429)
      return tooManyRequests(error.retryAfterSeconds).replace("saves", "requests");
    if (error.status === 503) return "The service is busy. Try again in a moment.";
  }
  return `The ${what} could not be loaded. Please try again.`;
}
