/** Raised when a test tries to use a database that is not clearly a throwaway test database. */
export class TestDatabaseGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestDatabaseGuardError";
  }
}

const SAFE_DATABASE_NAME = /^[a-z][a-z0-9_]*_test$/;

/**
 * Integration tests wipe tables, so they must never run against a real database. Returns the
 * parsed URL when its database name is lowercase snake_case and ends in `_test`; throws otherwise.
 * The strict name pattern also makes the name safe to interpolate into `CREATE DATABASE`.
 */
export function assertTestDatabaseUrl(rawUrl: string | undefined): URL {
  if (!rawUrl) {
    throw new TestDatabaseGuardError("TEST_DATABASE_URL is not set (see .env.example).");
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new TestDatabaseGuardError("TEST_DATABASE_URL is not a valid URL.");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new TestDatabaseGuardError("TEST_DATABASE_URL must use the postgres:// scheme.");
  }

  const name = databaseName(url);
  if (!SAFE_DATABASE_NAME.test(name)) {
    throw new TestDatabaseGuardError(
      "Refusing to run: the TEST_DATABASE_URL database name must be lowercase snake_case and end in _test.",
    );
  }
  return url;
}

/** The database name from a connection URL (path without the leading slash). */
export function databaseName(url: URL): string {
  return decodeURIComponent(url.pathname.replace(/^\//, ""));
}

/** The same server and credentials, pointing at the maintenance database `postgres`. */
export function adminUrlFor(url: URL): string {
  const admin = new URL(url.toString());
  admin.pathname = "/postgres";
  return admin.toString();
}

/** Same server and credentials, different database name (still subject to the guard). */
export function urlForDatabase(url: URL, name: string): string {
  const next = new URL(url.toString());
  next.pathname = `/${name}`;
  assertTestDatabaseUrl(next.toString());
  return next.toString();
}
