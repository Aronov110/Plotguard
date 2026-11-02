import type { Writable } from "node:stream";
import type { FastifyServerOptions } from "fastify";
import type { Env } from "./env.ts";
import { serializeError, serializeRequest } from "./log-serializers.ts";

/** Header names whose values are credentials. Matching is case-sensitive, so variants are listed. */
const SENSITIVE_HEADERS = [
  "authorization",
  "cookie",
  "set-cookie",
  "x-csrf-token",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "x-auth-token",
] as const;

/** Spellings that libraries commonly send besides lowercase and Title-Case. */
const EXTRA_HEADER_SPELLINGS = ["X-CSRF-Token", "X-API-Key"] as const;

/** Body or object fields that hold passwords, tokens or their hashes. */
const SENSITIVE_FIELDS = [
  "password",
  "newPassword",
  "currentPassword",
  "passwordHash",
  "token",
  "accessToken",
  "refreshToken",
  "password_hash",
  "token_hash",
  "refresh_token",
  "access_token",
  "new_password",
  "current_password",
] as const;

function titleCase(header: string): string {
  return header
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("-");
}

const HEADER_SPELLINGS: readonly string[] = [
  ...new Set([
    ...SENSITIVE_HEADERS,
    ...SENSITIVE_HEADERS.map(titleCase),
    ...EXTRA_HEADER_SPELLINGS,
  ]),
];

/**
 * Redaction paths for credentials in anything that gets logged. The wildcards cover the key itself,
 * one level down (`x.password`) and two levels down (`x.y.password`).
 *
 * Fastify's `req`/`res` serializers already drop headers, so this is defence in depth for anything
 * else that logs them: an upstream HTTP error, a manual `log.info({ headers })`, or a body dump.
 */
export const REDACTED_PATHS: readonly string[] = [
  ...HEADER_SPELLINGS.flatMap((header) => [
    `headers["${header}"]`,
    `*.headers["${header}"]`,
    `*.*.headers["${header}"]`,
  ]),
  ...SENSITIVE_FIELDS.flatMap((field) => [field, `*.${field}`, `*.*.${field}`]),
];

/** Logger configuration. Silent in tests unless a stream is given to capture the output. */
export function buildLoggerOptions(
  env: Env,
  stream?: Writable,
): Exclude<FastifyServerOptions["logger"], undefined> {
  if (env.NODE_ENV === "test" && stream === undefined) return false;
  return {
    level: "info",
    redact: { paths: [...REDACTED_PATHS], censor: "[Redacted]" },
    serializers: { err: serializeError, req: serializeRequest },
    ...(stream === undefined ? {} : { stream }),
  };
}
