import { describe, expect, it } from "vitest";
import { EnvValidationError, loadEnv } from "../config/env.ts";

const validDatabaseUrl = "postgres://user:pass@127.0.0.1:5432/db";

describe("loadEnv", () => {
  it("accepts a minimal valid environment and applies defaults", () => {
    const env = loadEnv({ DATABASE_URL: validDatabaseUrl });
    expect(env).toEqual({
      NODE_ENV: "development",
      API_HOST: "127.0.0.1",
      API_PORT: 3000,
      DATABASE_URL: validDatabaseUrl,
    });
  });

  it("coerces API_PORT from a string to a number", () => {
    expect(loadEnv({ DATABASE_URL: validDatabaseUrl, API_PORT: "8080" }).API_PORT).toBe(8080);
  });

  it("accepts the postgresql:// scheme", () => {
    const url = "postgresql://user:pass@127.0.0.1:5432/db";
    expect(loadEnv({ DATABASE_URL: url }).DATABASE_URL).toBe(url);
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => loadEnv({})).toThrow(EnvValidationError);
  });

  it("rejects an empty DATABASE_URL", () => {
    expect(() => loadEnv({ DATABASE_URL: "" })).toThrow(EnvValidationError);
  });

  it("rejects a DATABASE_URL that is not a URL", () => {
    expect(() => loadEnv({ DATABASE_URL: "not a url" })).toThrow(EnvValidationError);
  });

  it("rejects a DATABASE_URL with a non-postgres scheme", () => {
    expect(() => loadEnv({ DATABASE_URL: "mysql://user:pass@127.0.0.1/db" })).toThrow(
      EnvValidationError,
    );
  });

  it.each(["0", "65536", "-1", "abc", "3000.5", ""])("rejects invalid API_PORT %j", (port) => {
    expect(() => loadEnv({ DATABASE_URL: validDatabaseUrl, API_PORT: port })).toThrow(
      EnvValidationError,
    );
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(() => loadEnv({ DATABASE_URL: validDatabaseUrl, NODE_ENV: "staging" })).toThrow(
      EnvValidationError,
    );
  });

  it("rejects an empty API_HOST", () => {
    expect(() => loadEnv({ DATABASE_URL: validDatabaseUrl, API_HOST: "" })).toThrow(
      EnvValidationError,
    );
  });

  it("reports every problem at once", () => {
    try {
      loadEnv({ API_PORT: "abc" });
      expect.unreachable("loadEnv should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const issues = (error as EnvValidationError).issues;
      expect(issues.some((i) => i.startsWith("DATABASE_URL"))).toBe(true);
      expect(issues.some((i) => i.startsWith("API_PORT"))).toBe(true);
    }
  });

  it("never includes secret values in the error message", () => {
    const secret = "mysql://admin:super-secret-password@host/db";
    try {
      loadEnv({ DATABASE_URL: secret });
      expect.unreachable("loadEnv should have thrown");
    } catch (error) {
      expect((error as Error).message).not.toContain("super-secret-password");
    }
  });
});
