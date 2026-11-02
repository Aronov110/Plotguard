import type { Writable } from "node:stream";
import type { FastifyServerOptions } from "fastify";
import type { Env } from "./env.ts";

const SENSITIVE_HEADERS = ["authorization", "cookie", "set-cookie", "x-csrf-token"] as const;

/**
 * Redaction paths for credentials in logged headers. Fastify's own `req`/`res` serializers already
 * drop headers, so this is defence in depth for anything else that logs them: an upstream HTTP
 * error, a manual `log.info({ headers })`, or a future custom serializer. The wildcards cover
 * `headers`, `x.headers` and `x.y.headers`.
 */
export const REDACTED_PATHS: readonly string[] = SENSITIVE_HEADERS.flatMap((header) => [
  `headers["${header}"]`,
  `*.headers["${header}"]`,
  `*.*.headers["${header}"]`,
]);

/** Logger configuration. Silent in tests unless a stream is given to capture the output. */
export function buildLoggerOptions(
  env: Env,
  stream?: Writable,
): Exclude<FastifyServerOptions["logger"], undefined> {
  if (env.NODE_ENV === "test" && stream === undefined) return false;
  return {
    level: "info",
    redact: { paths: [...REDACTED_PATHS], censor: "[Redacted]" },
    ...(stream === undefined ? {} : { stream }),
  };
}
