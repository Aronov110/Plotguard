import { describe, expect, it } from "vitest";
import { EnvValidationError, loadDatabaseEnv, loadEnv } from "../config/env.ts";

const validDatabaseUrl = "postgres://user:pass@127.0.0.1:5432/db";
const validSecret = "k3Y7mQ2vX9bR5tN8wZ1cL6hD4fJ0sA3gUe7Pq2OxVn8Rb5Tm";
/** Everything required, so a test can break exactly one setting. */
const base = { NODE_ENV: "development", JWT_ACCESS_SECRET: validSecret } as const;

describe("loadEnv", () => {
  it("accepts a minimal valid environment and applies defaults", () => {
    const env = loadEnv({ ...base, DATABASE_URL: validDatabaseUrl });
    expect(env).toEqual({
      NODE_ENV: "development",
      API_HOST: "127.0.0.1",
      API_PORT: 3000,
      DATABASE_URL: validDatabaseUrl,
      JWT_ACCESS_SECRET: validSecret,
      ACCESS_TOKEN_TTL_SECONDS: 900,
      REFRESH_TOKEN_TTL_DAYS: 30,
      REFRESH_REUSE_GRACE_SECONDS: 10,
      CORS_ORIGINS: ["http://127.0.0.1:5173", "http://localhost:5173"],
      RATE_LIMIT_MAX: 100,
      RATE_LIMIT_WINDOW_SECONDS: 60,
    });
  });

  it("coerces API_PORT from a string to a number", () => {
    expect(loadEnv({ ...base, DATABASE_URL: validDatabaseUrl, API_PORT: "8080" }).API_PORT).toBe(
      8080,
    );
  });

  it("accepts the postgresql:// scheme", () => {
    const url = "postgresql://user:pass@127.0.0.1:5432/db";
    expect(loadEnv({ ...base, DATABASE_URL: url }).DATABASE_URL).toBe(url);
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => loadEnv({})).toThrow(EnvValidationError);
  });

  it("rejects an empty DATABASE_URL", () => {
    expect(() => loadEnv({ ...base, DATABASE_URL: "" })).toThrow(EnvValidationError);
  });

  it("rejects a DATABASE_URL that is not a URL", () => {
    expect(() => loadEnv({ ...base, DATABASE_URL: "not a url" })).toThrow(EnvValidationError);
  });

  it("rejects a DATABASE_URL with a non-postgres scheme", () => {
    expect(() => loadEnv({ ...base, DATABASE_URL: "mysql://user:pass@127.0.0.1/db" })).toThrow(
      EnvValidationError,
    );
  });

  it.each(["0", "65536", "-1", "abc", "3000.5", ""])("rejects invalid API_PORT %j", (port) => {
    expect(() => loadEnv({ ...base, DATABASE_URL: validDatabaseUrl, API_PORT: port })).toThrow(
      EnvValidationError,
    );
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(() => loadEnv({ ...base, DATABASE_URL: validDatabaseUrl, NODE_ENV: "staging" })).toThrow(
      EnvValidationError,
    );
  });

  it("rejects an empty API_HOST", () => {
    expect(() => loadEnv({ ...base, DATABASE_URL: validDatabaseUrl, API_HOST: "" })).toThrow(
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
      loadEnv({ ...base, DATABASE_URL: secret });
      expect.unreachable("loadEnv should have thrown");
    } catch (error) {
      expect((error as Error).message).not.toContain("super-secret-password");
    }
  });

  describe("CORS_ORIGINS", () => {
    const load = (CORS_ORIGINS: string, extra: Record<string, string> = {}) =>
      loadEnv({ ...base, DATABASE_URL: validDatabaseUrl, CORS_ORIGINS, ...extra });

    it("parses a comma-separated list and trims whitespace", () => {
      expect(load(" https://app.example.com , http://localhost:5173 ").CORS_ORIGINS).toEqual([
        "https://app.example.com",
        "http://localhost:5173",
      ]);
    });

    it("accepts a single origin", () => {
      expect(load("https://app.example.com").CORS_ORIGINS).toEqual(["https://app.example.com"]);
    });

    it("removes duplicates", () => {
      expect(load("https://a.example.com,https://a.example.com").CORS_ORIGINS).toEqual([
        "https://a.example.com",
      ]);
    });

    it("normalises a trailing-slash-free origin with a default port", () => {
      expect(load("https://app.example.com:443").CORS_ORIGINS).toEqual(["https://app.example.com"]);
    });

    it.each([
      ["a wildcard", "*"],
      ["a wildcard in a list", "https://a.example.com,*"],
      ["an empty value", ""],
      ["only whitespace", "   "],
      ["an empty entry", "https://a.example.com,,https://b.example.com"],
      ["a trailing comma", "https://a.example.com,"],
      ["a path", "https://a.example.com/app"],
      ["a trailing slash", "https://a.example.com/"],
      ["a query string", "https://a.example.com?x=1"],
      ["credentials in the URL", "https://user:pass@a.example.com"],
      ["no scheme", "a.example.com"],
      ["a non-http scheme", "ftp://a.example.com"],
      ["the string null", "null"],
      ["garbage", "not an origin"],
      ["a wildcard host", "http://*"],
      ["a wildcard subdomain", "https://*.example.com"],
      ["a wildcard inside a host", "https://app.*.example.com"],
      ["a backslash", "http://good.com\\evil"],
      ["an encoded backslash tail", "https://good.com\\"],
    ])("rejects %s", (_label, value) => {
      expect(() => load(value)).toThrow(EnvValidationError);
    });

    it("keeps http origins in development and test", () => {
      for (const NODE_ENV of ["development", "test"]) {
        expect(load("http://localhost:5173", { NODE_ENV }).CORS_ORIGINS).toEqual([
          "http://localhost:5173",
        ]);
      }
    });

    it.each([
      ["a single http origin", "http://app.example.com"],
      ["http localhost", "http://localhost:5173"],
      ["one http origin in a mixed list", "https://app.example.com,http://other.example.com"],
      ["an uppercase http scheme", "HTTP://app.example.com"],
    ])("rejects %s in production", (_label, value) => {
      expect(() => load(value, { NODE_ENV: "production" })).toThrow(EnvValidationError);
    });

    it("accepts several https origins in production", () => {
      const env = load("https://app.example.com, https://admin.example.com", {
        NODE_ENV: "production",
      });
      expect(env.CORS_ORIGINS).toEqual(["https://app.example.com", "https://admin.example.com"]);
    });

    it("explains the https rule in production without echoing the value", () => {
      try {
        load("http://secret-host.example.com", { NODE_ENV: "production" });
        expect.unreachable("loadEnv should have thrown");
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain("https");
        expect(message).not.toContain("secret-host");
      }
    });

    it("is required in production", () => {
      expect(() =>
        loadEnv({ ...base, DATABASE_URL: validDatabaseUrl, NODE_ENV: "production" }),
      ).toThrow(EnvValidationError);
    });

    it("is accepted in production when set", () => {
      const env = load("https://app.example.com", { NODE_ENV: "production" });
      expect(env.CORS_ORIGINS).toEqual(["https://app.example.com"]);
    });

    it("never echoes the offending value in the error", () => {
      try {
        load("https://user:hunter2@a.example.com");
        expect.unreachable("loadEnv should have thrown");
      } catch (error) {
        expect((error as Error).message).not.toContain("hunter2");
      }
    });
  });

  describe("rate limit settings", () => {
    it("coerces numeric strings", () => {
      const env = loadEnv({
        ...base,
        DATABASE_URL: validDatabaseUrl,
        RATE_LIMIT_MAX: "5",
        RATE_LIMIT_WINDOW_SECONDS: "10",
      });
      expect(env.RATE_LIMIT_MAX).toBe(5);
      expect(env.RATE_LIMIT_WINDOW_SECONDS).toBe(10);
    });

    it.each(["0", "-1", "abc", "1.5", "", "100001"])(
      "rejects invalid RATE_LIMIT_MAX %j",
      (value) => {
        expect(() =>
          loadEnv({ ...base, DATABASE_URL: validDatabaseUrl, RATE_LIMIT_MAX: value }),
        ).toThrow(EnvValidationError);
      },
    );

    it.each(["0", "-1", "abc", "1.5", "", "86401"])(
      "rejects invalid RATE_LIMIT_WINDOW_SECONDS %j",
      (value) => {
        expect(() =>
          loadEnv({ ...base, DATABASE_URL: validDatabaseUrl, RATE_LIMIT_WINDOW_SECONDS: value }),
        ).toThrow(EnvValidationError);
      },
    );
  });
});

describe("NODE_ENV", () => {
  it("is required: there is no default that could fail open", () => {
    expect(() =>
      loadEnv({ DATABASE_URL: validDatabaseUrl, JWT_ACCESS_SECRET: validSecret }),
    ).toThrow(EnvValidationError);
  });

  it("names NODE_ENV in the error when it is missing", () => {
    try {
      loadEnv({ DATABASE_URL: validDatabaseUrl, JWT_ACCESS_SECRET: validSecret });
      expect.unreachable("loadEnv should have thrown");
    } catch (error) {
      expect((error as EnvValidationError).issues.some((i) => i.startsWith("NODE_ENV"))).toBe(true);
    }
  });

  it("rejects an empty NODE_ENV", () => {
    expect(() => loadEnv({ ...base, DATABASE_URL: validDatabaseUrl, NODE_ENV: "" })).toThrow(
      EnvValidationError,
    );
  });

  it.each(["development", "test"])("accepts %s", (NODE_ENV) => {
    expect(loadEnv({ ...base, DATABASE_URL: validDatabaseUrl, NODE_ENV }).NODE_ENV).toBe(NODE_ENV);
  });
});

describe("JWT_ACCESS_SECRET", () => {
  const load = (JWT_ACCESS_SECRET: string | undefined, NODE_ENV = "development") =>
    loadEnv({
      NODE_ENV,
      DATABASE_URL: validDatabaseUrl,
      ...(NODE_ENV === "production" ? { CORS_ORIGINS: "https://app.example.com" } : {}),
      ...(JWT_ACCESS_SECRET === undefined ? {} : { JWT_ACCESS_SECRET }),
    });

  it("is required", () => {
    expect(() => load(undefined)).toThrow(EnvValidationError);
  });

  it("rejects an empty value", () => {
    expect(() => load("")).toThrow(EnvValidationError);
  });

  it("rejects 31 characters and accepts 32", () => {
    expect(() => load("a".repeat(31))).toThrow(EnvValidationError);
    expect(load("a".repeat(32)).JWT_ACCESS_SECRET).toBe("a".repeat(32));
  });

  it("accepts a long generated secret", () => {
    const secret = "k3Y7mQ2vX9bR5tN8wZ1cL6hD4fJ0sA3gUe7Pq2OxVn8Rb5Tm".repeat(3);
    expect(load(secret).JWT_ACCESS_SECRET).toBe(secret);
  });

  it.each([
    ["a leading space", ` ${"a".repeat(40)}`],
    ["a trailing space", `${"a".repeat(40)} `],
    ["a trailing newline", `${"a".repeat(40)}\n`],
  ])("rejects %s, which is almost always a paste mistake", (_label, value) => {
    expect(() => load(value)).toThrow(EnvValidationError);
  });

  it("rejects 32 spaces", () => {
    expect(() => load(" ".repeat(32))).toThrow(EnvValidationError);
  });

  it("rejects the .env.example placeholder in production only", () => {
    const placeholder = "change-me-generate-with-openssl-rand-base64-48";
    expect(() => load(placeholder, "production")).toThrow(EnvValidationError);
    expect(load(placeholder, "development").JWT_ACCESS_SECRET).toBe(placeholder);
  });

  it("accepts a real secret in production", () => {
    expect(load(validSecret, "production").JWT_ACCESS_SECRET).toBe(validSecret);
  });

  it("never echoes the secret in an error", () => {
    const tooShort = "SHORT-SECRET-VALUE";
    try {
      load(tooShort);
      expect.unreachable("loadEnv should have thrown");
    } catch (error) {
      expect((error as Error).message).not.toContain(tooShort);
    }
  });
});

describe("token lifetime settings", () => {
  const load = (extra: Record<string, string>) =>
    loadEnv({ ...base, DATABASE_URL: validDatabaseUrl, ...extra });

  it("coerces numeric strings", () => {
    const env = load({
      ACCESS_TOKEN_TTL_SECONDS: "120",
      REFRESH_TOKEN_TTL_DAYS: "7",
      REFRESH_REUSE_GRACE_SECONDS: "3",
    });
    expect([
      env.ACCESS_TOKEN_TTL_SECONDS,
      env.REFRESH_TOKEN_TTL_DAYS,
      env.REFRESH_REUSE_GRACE_SECONDS,
    ]).toEqual([120, 7, 3]);
  });

  it.each(["59", "3601", "0", "-1", "abc", "1.5", ""])(
    "rejects ACCESS_TOKEN_TTL_SECONDS %j",
    (value) => {
      expect(() => load({ ACCESS_TOKEN_TTL_SECONDS: value })).toThrow(EnvValidationError);
    },
  );

  it.each(["60", "3600"])("accepts the edge ACCESS_TOKEN_TTL_SECONDS %s", (value) => {
    expect(load({ ACCESS_TOKEN_TTL_SECONDS: value }).ACCESS_TOKEN_TTL_SECONDS).toBe(Number(value));
  });

  it.each(["0", "91", "-1", "abc", "1.5", ""])("rejects REFRESH_TOKEN_TTL_DAYS %j", (value) => {
    expect(() => load({ REFRESH_TOKEN_TTL_DAYS: value })).toThrow(EnvValidationError);
  });

  it.each(["1", "90"])("accepts the edge REFRESH_TOKEN_TTL_DAYS %s", (value) => {
    expect(load({ REFRESH_TOKEN_TTL_DAYS: value }).REFRESH_TOKEN_TTL_DAYS).toBe(Number(value));
  });

  it.each(["-1", "61", "abc", "1.5", ""])("rejects REFRESH_REUSE_GRACE_SECONDS %j", (value) => {
    expect(() => load({ REFRESH_REUSE_GRACE_SECONDS: value })).toThrow(EnvValidationError);
  });

  it.each(["0", "60"])("accepts the edge REFRESH_REUSE_GRACE_SECONDS %s", (value) => {
    expect(load({ REFRESH_REUSE_GRACE_SECONDS: value }).REFRESH_REUSE_GRACE_SECONDS).toBe(
      Number(value),
    );
  });
});

describe("loadDatabaseEnv", () => {
  it("needs only NODE_ENV and DATABASE_URL, so migrations do not require auth secrets", () => {
    expect(loadDatabaseEnv({ NODE_ENV: "development", DATABASE_URL: validDatabaseUrl })).toEqual({
      NODE_ENV: "development",
      DATABASE_URL: validDatabaseUrl,
    });
  });

  it("ignores unrelated variables", () => {
    const env = loadDatabaseEnv({
      NODE_ENV: "test",
      DATABASE_URL: validDatabaseUrl,
      JWT_ACCESS_SECRET: "short",
      CORS_ORIGINS: "*",
    });
    expect(env).not.toHaveProperty("JWT_ACCESS_SECRET");
  });

  it("rejects a missing DATABASE_URL and a missing NODE_ENV", () => {
    expect(() => loadDatabaseEnv({ NODE_ENV: "test" })).toThrow(EnvValidationError);
    expect(() => loadDatabaseEnv({ DATABASE_URL: validDatabaseUrl })).toThrow(EnvValidationError);
  });

  it("applies the same DATABASE_URL rules as loadEnv", () => {
    expect(() =>
      loadDatabaseEnv({ NODE_ENV: "test", DATABASE_URL: "mysql://u:p@127.0.0.1/db" }),
    ).toThrow(EnvValidationError);
  });
});
