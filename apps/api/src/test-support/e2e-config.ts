import { type AuthLimits, DEFAULT_AUTH_LIMITS } from "../auth/limits.ts";
import { type Env, loadEnv } from "../config/env.ts";
import {
  assertTestDatabaseUrl,
  databaseName,
  urlForDatabase,
} from "../db/test-support/assert-test-database.ts";

/** Where the end-to-end API listens. Not the development port, so both can run side by side. */
export const E2E_API_PORT = 3100;

/** The only browser origin the end-to-end API accepts: the web app served by `vite preview`. */
export const E2E_WEB_ORIGIN = "http://127.0.0.1:4173";

/** The throwaway database of the end-to-end tests. Rebuilt on every run, so never keep data in it. */
export const E2E_DATABASE_NAME = "plotpal_e2e_test";

/** Raised when the end-to-end server is asked to run in a way that could harm real data. */
export class E2eConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "E2eConfigError";
  }
}

export interface E2eSettings {
  readonly env: Env;
  /** The guarded URL of {@link E2E_DATABASE_NAME}. */
  readonly databaseUrl: string;
  readonly authLimits: AuthLimits;
}

/** A limit no test run can reach, so sign-ups and logins from one address are not throttled. */
const UNREACHED = { max: 100_000, windowSeconds: 60 } as const;

/**
 * Builds the settings of the end-to-end API from the process environment.
 *
 * Safety rules, all checked here so they can be tested without starting a server:
 * - never in production;
 * - the database is always `plotpal_e2e_test` on the server named by `TEST_DATABASE_URL`, and that
 *   URL must itself pass the `_test` guard, so the development database and the shared
 *   integration-test database can never be selected;
 * - it listens on loopback only, and accepts calls from the end-to-end web origin only.
 *
 * Only the per-address limits are relaxed (a run signs up and logs in more often than a person
 * would). The per-email failure limits keep their real values.
 *
 * @throws E2eConfigError when a rule is broken. Messages never contain values from the environment.
 */
export function buildE2eSettings(
  source: Readonly<Record<string, string | undefined>>,
): E2eSettings {
  if (source.NODE_ENV === "production") {
    throw new E2eConfigError("The end-to-end server must not run with NODE_ENV=production.");
  }

  let databaseUrl: string;
  try {
    databaseUrl = urlForDatabase(
      assertTestDatabaseUrl(source.TEST_DATABASE_URL),
      E2E_DATABASE_NAME,
    );
  } catch (cause) {
    throw new E2eConfigError("TEST_DATABASE_URL is missing or is not a safe *_test database URL.", {
      cause,
    });
  }
  if (databaseName(new URL(databaseUrl)) !== E2E_DATABASE_NAME) {
    throw new E2eConfigError("The end-to-end database name is not the expected one.");
  }

  const env = loadEnv({
    ...source,
    API_HOST: "127.0.0.1",
    API_PORT: String(E2E_API_PORT),
    DATABASE_URL: databaseUrl,
    CORS_ORIGINS: E2E_WEB_ORIGIN,
    RATE_LIMIT_MAX: String(UNREACHED.max),
    RATE_LIMIT_WINDOW_SECONDS: String(UNREACHED.windowSeconds),
  });

  return {
    env,
    databaseUrl,
    authLimits: {
      ...DEFAULT_AUTH_LIMITS,
      register: UNREACHED,
      login: UNREACHED,
      refresh: UNREACHED,
      logout: UNREACHED,
    },
  };
}
