/**
 * Log serializers that keep personal data and credentials out of the logs.
 *
 * Why this exists: Drizzle's `DrizzleQueryError` puts the bound parameters into its message
 * (`Failed query: ...\nparams: ...`), and `pg` errors can quote values in `detail` or in the
 * message of data errors (`invalid input syntax for type uuid: "..."`). Logged as-is, an email
 * or a token hash would end up in the logs. Logs are kept longer and shared wider than the database.
 */

const MAX_CAUSE_DEPTH = 3;
const MAX_QUERY_LENGTH = 2000;
const MAX_NON_ERROR_LENGTH = 200;
const OMITTED_MESSAGE = "[message omitted: it may contain request values]";

/**
 * SQLSTATE classes whose messages only name things (constraints, tables, roles) and never quote data:
 * 08 connection, 23 integrity constraint, 28 authorisation, 3D catalog, 40 rollback, 42 syntax or
 * access rule, 53 resources, 57 operator intervention. Everything else (notably 22, data exception,
 * which quotes the offending value) has its message dropped.
 */
const SAFE_SQLSTATE_CLASSES: ReadonlySet<string> = new Set([
  "08",
  "23",
  "28",
  "3D",
  "40",
  "42",
  "53",
  "57",
]);

/** Driver error fields that describe where something failed, never what the data was. */
const DRIVER_FIELDS = ["schema", "table", "column", "constraint"] as const;

// These are type aliases, not interfaces, on purpose: an alias is assignable to Fastify's logger
// serializer type, which has an index signature. An interface is not.
// `stack` is always present because that type requires it; it is "" when there is none to show.

export type SerializedError = {
  type: string;
  message: string;
  stack: string;
  code?: string;
  severity?: string;
  schema?: string;
  table?: string;
  column?: string;
  constraint?: string;
  query?: string;
  cause?: SerializedError | SerializedNonError;
};

export type SerializedNonError = {
  type: "NonError";
  valueType: string;
  message: string;
  stack: string;
};

type Fields = Readonly<Record<string, unknown>>;

const STACK_OMITTED = "[stack omitted: it quoted request values]";

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function serializeNonError(value: unknown): SerializedNonError {
  const valueType = value === null ? "null" : typeof value;
  return {
    type: "NonError",
    valueType,
    message:
      typeof value === "string"
        ? value.slice(0, MAX_NON_ERROR_LENGTH)
        : `[a ${valueType} was thrown, not an error]`,
    stack: "",
  };
}

function isDrizzleQueryError(fields: Fields): boolean {
  return typeof fields.query === "string" && "params" in fields;
}

function isDriverError(fields: Fields): boolean {
  return typeof fields.code === "string" && typeof fields.severity === "string";
}

function hasSafeMessage(code: string): boolean {
  return SAFE_SQLSTATE_CLASSES.has(code.slice(0, 2).toUpperCase());
}

/** Replaces the first occurrence of the original message in the stack's header line. */
function rebuildStack(
  stack: string,
  originalMessage: string,
  safeMessage: string,
): string | undefined {
  if (originalMessage === safeMessage) return stack;
  if (originalMessage.length === 0 || !stack.includes(originalMessage)) return undefined;
  return stack.replace(originalMessage, () => safeMessage);
}

function serializeErrorAt(error: Error, depth: number, seen: WeakSet<object>): SerializedError {
  seen.add(error);
  const fields = error as unknown as Fields;
  const drizzle = isDrizzleQueryError(fields);
  const driver = isDriverError(fields);
  const code = str(fields.code);

  let message: string;
  if (drizzle) {
    message = `Failed query: ${(fields.query as string).slice(0, MAX_QUERY_LENGTH)}`;
  } else if (driver && code !== undefined && !hasSafeMessage(code)) {
    message = OMITTED_MESSAGE;
  } else {
    message = error.message;
  }

  const rawStack =
    typeof error.stack === "string"
      ? (rebuildStack(error.stack, error.message, message) ?? STACK_OMITTED)
      : "";
  const out: SerializedError = {
    type: drizzle ? "DrizzleQueryError" : str(error.name) || error.constructor?.name || "Error",
    message,
    stack: rawStack,
  };

  if (code !== undefined) out.code = code;
  if (drizzle) out.query = (fields.query as string).slice(0, MAX_QUERY_LENGTH);

  if (driver) {
    const severity = str(fields.severity);
    if (severity !== undefined) out.severity = severity;
    for (const key of DRIVER_FIELDS) {
      const value = str(fields[key]);
      if (value !== undefined) out[key] = value;
    }
  }

  const cause = error.cause;
  if (cause !== undefined && depth < MAX_CAUSE_DEPTH) {
    if (cause instanceof Error) {
      if (!seen.has(cause)) out.cause = serializeErrorAt(cause, depth + 1, seen);
    } else {
      out.cause = serializeNonError(cause);
    }
  }
  return out;
}

/**
 * Serializer for the `err` log key. Keeps what is needed to debug (type, SQLSTATE, constraint,
 * table, query text with placeholders, stack) and drops what can hold request data (bound
 * parameters, `detail`, `where`, quoted values). Never throws, never copies arbitrary objects.
 */
export function serializeError(error: unknown): SerializedError | SerializedNonError {
  if (error instanceof Error) return serializeErrorAt(error, 0, new WeakSet());
  return serializeNonError(error);
}

/** The parts of a Fastify request that the serializer reads. */
export interface SerializableRequest {
  readonly method?: string;
  readonly url?: string;
  readonly host?: string;
  readonly ip?: string;
  readonly socket?: { readonly remotePort?: number | undefined } | undefined;
}

export type SerializedRequest = {
  method?: string;
  url?: string;
  host?: string;
  remoteAddress?: string;
  remotePort?: number;
};

/**
 * Serializer for the `req` log key. Like Fastify's default, but the query string and fragment are
 * removed: tokens must never be logged even if some route takes them in the URL.
 */
export function serializeRequest(request: SerializableRequest): SerializedRequest {
  const out: SerializedRequest = {};
  if (request.method !== undefined) out.method = request.method;
  if (request.url !== undefined) out.url = request.url.split(/[?#]/, 1)[0] ?? "";
  if (request.host !== undefined) out.host = request.host;
  if (request.ip !== undefined) out.remoteAddress = request.ip;
  const port = request.socket?.remotePort;
  if (port !== undefined) out.remotePort = port;
  return out;
}
