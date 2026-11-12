export interface PgErrorInfo {
  /** The five-character SQLSTATE, for example 23505 for a unique violation. */
  readonly code: string;
  readonly constraint?: string;
}

const MAX_DEPTH = 5;
const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * Finds the PostgreSQL error inside whatever was thrown. Drizzle wraps driver errors, so the code
 * is on `cause`, not on the error itself. Returns `undefined` for anything that is not a database
 * error, including Node errors such as ECONNREFUSED.
 */
export function findPgError(error: unknown): PgErrorInfo | undefined {
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    if (typeof current !== "object" || current === null || seen.has(current)) return undefined;
    seen.add(current);
    const { code, constraint } = current as { code?: unknown; constraint?: unknown };
    if (typeof code === "string" && SQLSTATE.test(code)) {
      return typeof constraint === "string" ? { code, constraint } : { code };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * True when a statement gave up waiting for a lock (SQLSTATE 55P03, "lock_not_available"), which is
 * what PostgreSQL reports when `lock_timeout` runs out.
 */
export function isLockTimeout(error: unknown): boolean {
  return findPgError(error)?.code === "55P03";
}

/** True for a unique violation (23505), optionally only for one named constraint. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const info = findPgError(error);
  if (info?.code !== "23505") return false;
  return constraint === undefined || info.constraint === constraint;
}
