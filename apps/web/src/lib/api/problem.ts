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

// Everything below comes from the server, or from a proxy in front of it. React escapes text, so it
// cannot run as code, but it is still bounded and cleaned here so that no screen, log line or
// screen reader ever has to deal with a megabyte of text, terminal escape codes, or characters
// that reverse the direction of text.
const MAX_MESSAGE_CHARS = 300;
const MAX_POINTER_CHARS = 200;
const MAX_DETAIL_CHARS = 500;
const MAX_ISSUES = 20;
const CODE_PATTERN = /^[a-z0-9-]{1,64}$/;

/** Zero-width and direction-changing characters that can disguise text. */
function isInvisible(code: number): boolean {
  return (
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2064) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}

/**
 * Cuts `value` to `max` characters (whole characters, so an emoji is never split), turns control
 * characters (line breaks, tabs, escape codes) into spaces and removes invisible ones.
 * Returns `undefined` if nothing is left.
 */
function cleanText(value: string, max: number): string | undefined {
  let cleaned = "";
  let kept = 0;
  for (const char of value) {
    if (kept >= max) break;
    const code = char.codePointAt(0) ?? 0;
    if (isInvisible(code)) continue;
    cleaned += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? " " : char;
    kept++;
  }
  const trimmed = cleaned.trim();
  return trimmed === "" ? undefined : trimmed;
}

function readCode(type: unknown): string | undefined {
  if (typeof type !== "string" || !type.startsWith(PROBLEM_TYPE_PREFIX)) return undefined;
  const code = type.slice(PROBLEM_TYPE_PREFIX.length);
  return CODE_PATTERN.test(code) ? code : undefined;
}

function readIssues(errors: unknown): FieldIssue[] {
  if (!Array.isArray(errors)) return [];
  const issues: FieldIssue[] = [];
  for (const item of errors as unknown[]) {
    if (issues.length >= MAX_ISSUES) break;
    if (!isRecord(item) || typeof item.pointer !== "string" || typeof item.message !== "string") {
      continue;
    }
    const pointer = cleanText(item.pointer, MAX_POINTER_CHARS);
    const message = cleanText(item.message, MAX_MESSAGE_CHARS);
    if (pointer !== undefined && message !== undefined) issues.push({ pointer, message });
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
    detail:
      typeof problem.detail === "string" ? cleanText(problem.detail, MAX_DETAIL_CHARS) : undefined,
    issues: readIssues(problem.errors),
    retryAfterSeconds: readRetryAfter(response.headers.get("retry-after")),
  });
}
