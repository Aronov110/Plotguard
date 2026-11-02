/** One field-level problem in a rejected request. Never contains the submitted value. */
export interface ProblemIssue {
  /** Which part of the request the issue is in: body, querystring, params or headers. */
  readonly source: string;
  /** JSON Pointer (RFC 6901) to the offending field, relative to `source`. Empty for the root. */
  readonly pointer: string;
  readonly message: string;
}

export interface AppErrorInit {
  readonly status: number;
  /** Stable kebab-case slug. Becomes the Problem Details `type` URN. */
  readonly code: string;
  /** Short, human-readable summary of the problem type. */
  readonly title: string;
  /** Explanation of this occurrence. Safe to show to end users: never put secrets here. */
  readonly detail: string;
  /** Extra response headers, keyed by lowercase header name. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Extra Problem Details members. Cannot overwrite the standard members. */
  readonly extensions?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

/**
 * Base class for errors that are meant to reach the client.
 * The global error handler turns them into RFC 9457 Problem Details responses.
 * Anything that is not an `AppError` is treated as unexpected and reported as a generic 500.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly extensions: Readonly<Record<string, unknown>>;

  constructor(init: AppErrorInit) {
    super(init.detail, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = new.target.name;
    this.status = init.status;
    this.code = init.code;
    this.title = init.title;
    this.detail = init.detail;
    this.headers = init.headers ?? {};
    this.extensions = init.extensions ?? {};
  }
}

interface CauseOption {
  readonly cause?: unknown;
}

/** 400: the request is syntactically valid but fails validation. */
export class ValidationError extends AppError {
  constructor(
    issues: readonly ProblemIssue[],
    detail = "The request is invalid. See the errors member for details.",
    options: CauseOption = {},
  ) {
    super({
      status: 400,
      code: "validation-error",
      title: "Validation Failed",
      detail,
      extensions: { errors: issues },
      ...options,
    });
  }
}

/** 401: missing or invalid credentials. */
export class UnauthorizedError extends AppError {
  constructor(detail = "Authentication is required.", options: CauseOption = {}) {
    super({
      status: 401,
      code: "unauthorized",
      title: "Unauthorized",
      detail,
      headers: { "www-authenticate": "Bearer" },
      ...options,
    });
  }
}

/** 403: authenticated, but not allowed. */
export class ForbiddenError extends AppError {
  constructor(detail = "You are not allowed to do that.", options: CauseOption = {}) {
    super({ status: 403, code: "forbidden", title: "Forbidden", detail, ...options });
  }
}

/** 404: the resource does not exist, or the caller may not know that it does. */
export class NotFoundError extends AppError {
  constructor(detail = "The requested resource was not found.", options: CauseOption = {}) {
    super({ status: 404, code: "not-found", title: "Not Found", detail, ...options });
  }
}

/** 409: the request conflicts with the current state, for example a duplicate email. */
export class ConflictError extends AppError {
  constructor(
    detail = "The request conflicts with the current state of the resource.",
    options: CauseOption = {},
  ) {
    super({ status: 409, code: "conflict", title: "Conflict", detail, ...options });
  }
}

/** 429: too many requests. Sets `Retry-After` in whole seconds (minimum 1). */
export class RateLimitError extends AppError {
  constructor(retryAfterSeconds: number, options: CauseOption = {}) {
    const seconds = Number.isFinite(retryAfterSeconds)
      ? Math.max(1, Math.ceil(retryAfterSeconds))
      : 1;
    super({
      status: 429,
      code: "rate-limited",
      title: "Too Many Requests",
      detail: `Too many requests. Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`,
      headers: { "retry-after": String(seconds) },
      ...options,
    });
  }
}
