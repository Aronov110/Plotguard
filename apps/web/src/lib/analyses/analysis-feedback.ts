import { ApiError, NetworkError } from "../api/problem.ts";

/** How long to wait, in words: "30 seconds", "5 minutes", "2 hours". Rounds up, never to zero. */
export function describeWait(seconds: number): string {
  const safe = Math.max(1, Math.ceil(seconds));
  if (safe < 60) return `${safe} ${safe === 1 ? "second" : "seconds"}`;
  const minutes = Math.ceil(safe / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

/**
 * A value from a table, but only when the table itself has the key. A code that comes from the
 * server (`constructor`, `__proto__`) must never reach what every object inherits.
 */
function ownEntry(table: Readonly<Record<string, string>>, key: string, fallback: string): string {
  return Object.hasOwn(table, key) ? (table[key] ?? fallback) : fallback;
}

/** What went wrong when starting a run, in the few kinds that need a different reaction. */
export type StartProblem =
  /** A run is already going (409). The panel then watches that run instead. */
  | { readonly kind: "already-running" }
  /** The AI features cannot be used at all for now: nothing the writer does will change that. */
  | { readonly kind: "unavailable"; readonly message: string }
  /** Something about the request: a message tells the writer what to change or when to return. */
  | { readonly kind: "problem"; readonly message: string };

function tryAgainIn(seconds: number | undefined, fallback: string): string {
  return seconds === undefined ? fallback : `Try again in ${describeWait(seconds)}.`;
}

/**
 * Sorts a failed start into the kinds above and finds the words for it. Only fixed sentences are
 * shown: the technical `detail` of an error is never shown, and neither is the text of an unknown one.
 */
export function describeStartError(error: unknown): StartProblem {
  if (error instanceof NetworkError) {
    return {
      kind: "problem",
      message: "Can't reach the server. Check your connection and try again.",
    };
  }
  if (!(error instanceof ApiError)) {
    return { kind: "problem", message: "The scan could not be started. Please try again." };
  }

  switch (error.status) {
    case 404:
      return { kind: "problem", message: "This project or item no longer exists." };
    case 409:
      return { kind: "already-running" };
    case 413:
      return {
        kind: "problem",
        message:
          "The text is too long for one scan. Choose a single act or scene instead of the whole project.",
      };
    case 422:
      return { kind: "problem", message: "There is no text to read yet. Write something first." };
    case 429:
      if (error.code === "ai-daily-limit") {
        return {
          kind: "problem",
          message: `You have used your scans for the last 24 hours. ${tryAgainIn(error.retryAfterSeconds, "Try again later.")}`,
        };
      }
      return {
        kind: "problem",
        message: `Too many requests in a short time. ${tryAgainIn(error.retryAfterSeconds, "Try again soon.")}`,
      };
    case 503:
      if (error.code === "ai-budget-reached") {
        return {
          kind: "unavailable",
          message: "The AI budget for today is used up. Please try again later.",
        };
      }
      return {
        kind: "unavailable",
        message: "The AI scan is not switched on on this server.",
      };
    case 401:
      return {
        kind: "problem",
        message: "Your login has ended. Please log in again.",
      };
    default:
      return { kind: "problem", message: "The scan could not be started. Please try again." };
  }
}

/** What a failed run is told to the writer as: a sentence, and whether trying again can help. */
export interface RunFailure {
  readonly message: string;
}

const RUN_FAILURES: Readonly<Record<string, string>> = {
  refused:
    "The AI declined to read this text. This can happen with very dark or sensitive material. Nothing was found, and you can try again with a smaller part.",
  truncated:
    "The answer was cut off because it grew too long. Try a single act or scene instead of the whole project.",
  invalid_output: "The AI's answer could not be understood. Please try again.",
  rate_limited: "The AI service is receiving too many requests right now. Please try again soon.",
  overloaded: "The AI service is busy or down for the moment. Please try again soon.",
  timeout: "The scan took too long and was stopped. Try a single act or scene.",
  too_long: "The text is too long for the AI to read in one go. Choose a single act or scene.",
  not_configured: "The AI scan is not working on this server right now. Please tell the owner.",
  canceled: "You cancelled this scan.",
  interrupted: "The server restarted while the scan ran. Please start it again.",
  internal: "Something went wrong with the scan. Please try again.",
};

const UNKNOWN_FAILURE = "The scan did not finish. Please try again.";

/** The sentence for a run that ended with this code. A code it does not know gets a plain one. */
export function describeRunFailure(code: string | null): RunFailure {
  return {
    message: code === null ? UNKNOWN_FAILURE : ownEntry(RUN_FAILURES, code, UNKNOWN_FAILURE),
  };
}

/** What went wrong with a plain read (the estimate, the history), in one sentence. */
export function describeReadError(error: unknown, what: "estimate" | "history" | "run"): string {
  const noun =
    what === "estimate"
      ? "the cost estimate"
      : what === "history"
        ? "your earlier scans"
        : "the scan";
  if (error instanceof NetworkError) return `Can't reach the server to load ${noun}.`;
  if (error instanceof ApiError && error.status === 404) {
    return what === "run" ? "That scan no longer exists." : "This project no longer exists.";
  }
  if (error instanceof ApiError && error.status === 429) {
    return `Too many requests in a short time. ${tryAgainIn(error.retryAfterSeconds, "Try again soon.")}`;
  }
  return `Could not load ${noun}.`;
}

const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  continuity: "Continuity",
  timeline: "Timeline",
  motivation: "Motivation",
  logic: "Logic",
  setup_payoff: "Setup and payoff",
  character: "Character",
  world_rules: "World rules",
  other: "Other",
};

/** A kind of problem in words. A kind it does not know is made readable: `a_new_one` → "A new one". */
export function categoryLabel(category: string): string {
  if (Object.hasOwn(CATEGORY_LABELS, category)) return ownEntry(CATEGORY_LABELS, category, "Other");
  const spaced = category.replace(/[_-]+/g, " ").trim();
  return spaced === "" ? "Other" : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export type Severity = "major" | "moderate" | "minor";

const SEVERITY_LABELS: Readonly<Record<Severity, string>> = {
  major: "Major: breaks the story",
  moderate: "Moderate: a careful reader will notice",
  minor: "Minor: small",
};

export function severityLabel(severity: Severity): string {
  return SEVERITY_LABELS[severity];
}

/** The short word, for a badge. */
export function severityWord(severity: Severity): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}
