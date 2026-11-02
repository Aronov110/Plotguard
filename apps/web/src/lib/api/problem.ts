const PROBLEM_TYPE_PREFIX = "urn:plotpal:problem:";
const MAX_RETRY_AFTER_SECONDS = 3600;

/** One problem with one field, as the API reports it: `pointer` is a JSON pointer like `/email`. */
export interface FieldIssue {
  readonly pointer: string;
  readonly message: string;
}

export interface ApiErrorInit {
  readonly status: number;
  readonly code: string | undefined;
  readonly detail: string | undefined;
  readonly issues: readonly FieldIssue[];
  readonly retryAfterSeconds: number | undefined;
}

/**
 * The API answered, but with an error (any status outside 200 to 299). The fields come from its
 * RFC 9457 Problem Details body. `message` is fixed text on purpose: server text is shown to people
 * only by code that has decided it is safe to show (see `issues` and `detail`).
 */
export class ApiError extends Error {
  readonly status: number;
  /** The problem code, for example `validation-error`, or `undefined` if the body had none. */
  readonly code: string | undefined;
  /** The server's own explanation, for diagnostics. Do not show it for unknown problems. */
  readonly detail: string | undefined;
  /** Per-field messages, written by the server so that a form can show them next to the field. */
  readonly issues: readonly FieldIssue[];
  /** How long to wait, in seconds, from the `Retry-After` header. */
  readonly retryAfterSeconds: number | undefined;

  constructor(init: ApiErrorInit) {
    super(`The API answered with status ${init.status}.`);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.detail = init.detail;
    this.issues = init.issues;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }
}

/** The request never got an answer: offline, DNS failure, connection refused, blocked, ... */
export class NetworkError extends Error {
  constructor(options?: ErrorOptions) {
    super("Could not reach the server.", options);
    this.name = "NetworkError";
  }
}

/** The API answered with success, but the body was not what this app expects. */
export class ResponseShapeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ResponseShapeError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCode(type: unknown): string | undefined {
  if (typeof type !== "string" || !type.startsWith(PROBLEM_TYPE_PREFIX)) return undefined;
  const code = type.slice(PROBLEM_TYPE_PREFIX.length);
  return code === "" ? undefined : code;
}

function readIssues(errors: unknown): FieldIssue[] {
  if (!Array.isArray(errors)) return [];
  const issues: FieldIssue[] = [];
  for (const item of errors as unknown[]) {
    if (isRecord(item) && typeof item.pointer === "string" && typeof item.message === "string") {
      issues.push({ pointer: item.pointer, message: item.message });
    }
  }
  return issues;
}

function readRetryAfter(header: string | null): number | undefined {
  // Only whole seconds. The HTTP-date form is allowed by the standard but this API never sends it.
  if (header === null || !/^\d+$/.test(header)) return undefined;
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, Number(header)));
}

/**
 * Turns an error response into an {@link ApiError}. It never throws: a body that is empty, is not
 * JSON (a proxy's HTML error page, say) or has the wrong shape just gives an error with fewer fields.
 */
export async function readProblem(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // An unreadable body is normal for errors that did not come from the API itself.
    body = undefined;
  }
  const problem = isRecord(body) ? body : {};

  return new ApiError({
    status: response.status,
    code: readCode(problem.type),
    detail: typeof problem.detail === "string" ? problem.detail : undefined,
    issues: readIssues(problem.errors),
    retryAfterSeconds: readRetryAfter(response.headers.get("retry-after")),
  });
}
