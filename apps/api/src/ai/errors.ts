import { AppError } from "../errors/app-error.ts";

/** 503: the AI features are not switched on (no key, or switched off on purpose). */
export class AiUnavailableError extends AppError {
  constructor() {
    super({
      status: 503,
      code: "ai-unavailable",
      title: "AI Unavailable",
      detail: "The AI features are not available on this server.",
    });
  }
}

/** 422: there is no text to analyse yet. */
export class ManuscriptEmptyError extends AppError {
  constructor() {
    super({
      status: 422,
      code: "manuscript-empty",
      title: "Nothing To Analyse",
      detail: "There is no text to analyse yet. Write something first.",
    });
  }
}

/** 413: the text is longer than one run may send. */
export class ManuscriptTooLargeError extends AppError {
  constructor(estimatedTokens: number, limitTokens: number) {
    super({
      status: 413,
      code: "manuscript-too-large",
      title: "Text Too Long",
      detail:
        `This text is about ${estimatedTokens.toLocaleString("en")} tokens, more than the ` +
        `${limitTokens.toLocaleString("en")} one run may send. Choose a smaller part, such as one act or scene.`,
      extensions: { estimatedTokens, limitTokens },
    });
  }
}

/** 409: the person already has a run in progress; one at a time. */
export class RunInProgressError extends AppError {
  constructor() {
    super({
      status: 409,
      code: "run-in-progress",
      title: "Run In Progress",
      detail: "Another AI run of yours is still going. Wait for it to finish, or cancel it.",
    });
  }
}

/** 429: the person has used their share of runs or tokens for the last 24 hours. */
export class DailyLimitError extends AppError {
  constructor(retryAfterSeconds: number) {
    const seconds = Math.max(60, Math.ceil(retryAfterSeconds));
    super({
      status: 429,
      code: "ai-daily-limit",
      title: "Daily AI Limit Reached",
      detail: "You have used your AI runs for the last 24 hours. Try again later.",
      headers: { "retry-after": String(seconds) },
      extensions: { retryAfterSeconds: seconds },
    });
  }
}

/** 503: everybody together has used the day's budget. Nothing the person did. */
export class GlobalBudgetError extends AppError {
  constructor() {
    super({
      status: 503,
      code: "ai-budget-reached",
      title: "AI Budget Reached",
      detail: "The AI features have reached today's overall limit. Try again later.",
      headers: { "retry-after": "3600" },
    });
  }
}
