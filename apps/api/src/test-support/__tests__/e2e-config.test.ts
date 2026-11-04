import { describe, expect, it } from "vitest";
import { DEFAULT_AUTH_LIMITS } from "../../auth/limits.ts";
import { EnvValidationError } from "../../config/env.ts";
import {
  buildE2eSettings,
  E2E_API_PORT,
  E2E_DATABASE_NAME,
  E2E_WEB_ORIGIN,
  E2eConfigError,
} from "../e2e-config.ts";

// Every value here is made up for the tests.
const DB_PASSWORD = "s3cret!pw";
const JWT_SECRET = "unit-test-secret-with-many-different-chars-0123456789";

function source(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "development",
    JWT_ACCESS_SECRET: JWT_SECRET,
    DATABASE_URL: "postgres://dev:devpass@127.0.0.1:5433/plotpal",
    TEST_DATABASE_URL: `postgres://tester:${encodeURIComponent(DB_PASSWORD)}@127.0.0.1:5433/plotpal_test`,
    ...overrides,
  };
}

/** Runs `build` and returns what it threw, so the tests can inspect the message and the cause. */
function thrownBy(build: () => unknown): unknown {
  try {
    build();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the call to throw, but it returned.");
}

describe("buildE2eSettings: the database", () => {
  it("uses the throwaway e2e database on the server named by TEST_DATABASE_URL", () => {
    const { databaseUrl } = buildE2eSettings(source());
    const url = new URL(databaseUrl);
    expect(url.pathname).toBe(`/${E2E_DATABASE_NAME}`);
    expect(url.hostname).toBe("127.0.0.1");
    expect(url.port).toBe("5433");
    expect(url.username).toBe("tester");
    expect(decodeURIComponent(url.password)).toBe(DB_PASSWORD);
  });

  it("never selects the shared integration database", () => {
    const { databaseUrl } = buildE2eSettings(source());
    expect(new URL(databaseUrl).pathname).not.toBe("/plotpal_test");
  });

  it("never selects the development database", () => {
    const settings = buildE2eSettings(source());
    expect(new URL(settings.databaseUrl).pathname).not.toBe("/plotpal");
    expect(new URL(settings.env.DATABASE_URL).pathname).toBe(`/${E2E_DATABASE_NAME}`);
  });

  it("gives the app the e2e database, not the DATABASE_URL of the environment", () => {
    const { env, databaseUrl } = buildE2eSettings(source());
    expect(env.DATABASE_URL).toBe(databaseUrl);
    expect(env.DATABASE_URL).not.toContain("devpass");
  });

  it("accepts a TEST_DATABASE_URL that already names the e2e database", () => {
    const { databaseUrl } = buildE2eSettings(
      source({ TEST_DATABASE_URL: `postgres://t:p@127.0.0.1:5433/${E2E_DATABASE_NAME}` }),
    );
    expect(new URL(databaseUrl).pathname).toBe(`/${E2E_DATABASE_NAME}`);
  });

  it("accepts the postgresql:// scheme", () => {
    const { databaseUrl } = buildE2eSettings(
      source({ TEST_DATABASE_URL: "postgresql://t:p@127.0.0.1:5433/plotpal_test" }),
    );
    expect(new URL(databaseUrl).pathname).toBe(`/${E2E_DATABASE_NAME}`);
  });
});

describe("buildE2eSettings: refusals", () => {
  it("refuses NODE_ENV=production", () => {
    const error = thrownBy(() => buildE2eSettings(source({ NODE_ENV: "production" })));
    expect(error).toBeInstanceOf(E2eConfigError);
    expect(String(error)).not.toContain(JWT_SECRET);
    expect(String(error)).not.toContain(DB_PASSWORD);
  });

  it("accepts NODE_ENV=test", () => {
    expect(() => buildE2eSettings(source({ NODE_ENV: "test" }))).not.toThrow();
  });

  it("refuses a missing NODE_ENV, as the app itself does", () => {
    expect(() => buildE2eSettings(source({ NODE_ENV: undefined }))).toThrow(EnvValidationError);
  });

  it("refuses a missing TEST_DATABASE_URL", () => {
    expect(() => buildE2eSettings(source({ TEST_DATABASE_URL: undefined }))).toThrow(
      E2eConfigError,
    );
  });

  it("refuses an empty TEST_DATABASE_URL", () => {
    expect(() => buildE2eSettings(source({ TEST_DATABASE_URL: "" }))).toThrow(E2eConfigError);
  });

  it("refuses a TEST_DATABASE_URL that is not a URL", () => {
    expect(() => buildE2eSettings(source({ TEST_DATABASE_URL: "not a url" }))).toThrow(
      E2eConfigError,
    );
  });

  it("refuses a TEST_DATABASE_URL that is not a postgres URL", () => {
    expect(() =>
      buildE2eSettings(source({ TEST_DATABASE_URL: "http://127.0.0.1:5433/plotpal_test" })),
    ).toThrow(E2eConfigError);
  });

  it.each([
    ["a name that does not end in _test", "plotpal"],
    ["the development database name", "plotpal_dev"],
    ["a capitalised name", "Plotpal_Test"],
    ["a name with a dash", "plotpal-test"],
    ["a name with a space", "plotpal%20test"],
    ["a name that starts with a digit", "1plotpal_test"],
    ["an empty name", ""],
  ])("refuses %s", (_label, name) => {
    const error = thrownBy(() =>
      buildE2eSettings(
        source({
          TEST_DATABASE_URL: `postgres://tester:${encodeURIComponent(DB_PASSWORD)}@127.0.0.1:5433/${name}`,
        }),
      ),
    );
    expect(error).toBeInstanceOf(E2eConfigError);
  });

  it("never puts the database password or the secret into an error message or its cause", () => {
    const error = thrownBy(() =>
      buildE2eSettings(
        source({
          TEST_DATABASE_URL: `postgres://tester:${encodeURIComponent(DB_PASSWORD)}@127.0.0.1:5433/plotpal`,
        }),
      ),
    );
    const text = `${String(error)} ${String((error as Error).cause)}`;
    expect(text).not.toContain(DB_PASSWORD);
    expect(text).not.toContain(encodeURIComponent(DB_PASSWORD));
    expect(text).not.toContain(JWT_SECRET);
  });

  it("refuses a missing JWT secret without printing the other values", () => {
    const error = thrownBy(() => buildE2eSettings(source({ JWT_ACCESS_SECRET: undefined })));
    expect(error).toBeInstanceOf(EnvValidationError);
    expect(String(error)).not.toContain(DB_PASSWORD);
  });

  it("refuses the public placeholder secret outside NODE_ENV=test", () => {
    expect(() =>
      buildE2eSettings(source({ JWT_ACCESS_SECRET: "change-me-change-me-0123456789abcdef" })),
    ).toThrow(EnvValidationError);
  });
});

describe("buildE2eSettings: the server settings", () => {
  it("listens on loopback only, whatever the environment says", () => {
    expect(buildE2eSettings(source()).env.API_HOST).toBe("127.0.0.1");
    expect(buildE2eSettings(source({ API_HOST: "0.0.0.0" })).env.API_HOST).toBe("127.0.0.1");
    expect(buildE2eSettings(source({ API_HOST: "::" })).env.API_HOST).toBe("127.0.0.1");
  });

  it("uses its own port, not the development port", () => {
    expect(buildE2eSettings(source()).env.API_PORT).toBe(E2E_API_PORT);
    expect(buildE2eSettings(source({ API_PORT: "3000" })).env.API_PORT).toBe(E2E_API_PORT);
    expect(E2E_API_PORT).not.toBe(3000);
  });

  it("accepts calls only from the end-to-end web origin", () => {
    expect(buildE2eSettings(source()).env.CORS_ORIGINS).toEqual([E2E_WEB_ORIGIN]);
    expect(
      buildE2eSettings(source({ CORS_ORIGINS: "https://app.example.com,http://127.0.0.1:5173" }))
        .env.CORS_ORIGINS,
    ).toEqual([E2E_WEB_ORIGIN]);
  });

  it("relaxes the global rate limit", () => {
    const { env } = buildE2eSettings(source());
    expect(env.RATE_LIMIT_MAX).toBeGreaterThanOrEqual(100_000);
  });

  it("relaxes the per-address limits of sign-up, login, refresh and logout", () => {
    const { authLimits } = buildE2eSettings(source());
    for (const rule of [
      authLimits.register,
      authLimits.login,
      authLimits.refresh,
      authLimits.logout,
    ]) {
      expect(rule.max).toBeGreaterThan(DEFAULT_AUTH_LIMITS.login.max * 100);
    }
  });

  it("keeps the real limits on failed logins per email", () => {
    const { authLimits } = buildE2eSettings(source());
    expect(authLimits.loginFailuresPerEmailAndIp).toEqual(
      DEFAULT_AUTH_LIMITS.loginFailuresPerEmailAndIp,
    );
    expect(authLimits.loginFailuresPerEmail).toEqual(DEFAULT_AUTH_LIMITS.loginFailuresPerEmail);
  });

  it("keeps the token settings of the environment", () => {
    const { env } = buildE2eSettings(source({ ACCESS_TOKEN_TTL_SECONDS: "120" }));
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(120);
    expect(env.JWT_ACCESS_SECRET).toBe(JWT_SECRET);
  });

  it("does not change the environment object it was given", () => {
    const input = source({ API_HOST: "0.0.0.0" });
    const copy = { ...input };
    buildE2eSettings(input);
    expect(input).toEqual(copy);
  });

  it("keeps the shipped default limits unchanged", () => {
    const before = structuredClone(DEFAULT_AUTH_LIMITS);
    buildE2eSettings(source());
    expect(DEFAULT_AUTH_LIMITS).toEqual(before);
  });
});
