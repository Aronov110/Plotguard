import { z } from "zod";

const DEFAULT_DEV_CORS_ORIGINS: readonly string[] = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
];

/**
 * scheme://host[:port] only: no path, query, fragment, credentials, trailing slash, wildcard or
 * backslash (URL parsers treat `\` like `/`, which would silently rewrite the value).
 */
const ORIGIN_PATTERN = /^https?:\/\/[^/\\?#@*\s]+$/i;

/** Returns the normalised origin, or undefined when the value is not a plain http(s) origin. */
function parseOrigin(value: string): string | undefined {
  if (!ORIGIN_PATTERN.test(value)) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

/**
 * No default on purpose: a forgotten NODE_ENV must stop the app at startup, not quietly switch off
 * everything that only applies in production (the cookie Secure flag, the CORS rules).
 */
const nodeEnvSchema = z.enum(["development", "test", "production"]);

const databaseUrlSchema = z
  .string()
  .url()
  .refine((value) => /^postgres(ql)?:\/\//.test(value), {
    message: "DATABASE_URL must start with postgres:// or postgresql://",
  });

/** The value `.env.example` ships with. It must never be used for real. */
const SECRET_PLACEHOLDER_PREFIX = "change-me";
const MIN_DISTINCT_SECRET_CHARACTERS = 12;

const jwtSecretSchema = z
  .string()
  .min(32, "JWT_ACCESS_SECRET must be at least 32 characters")
  .refine((value) => value === value.trim(), {
    message: "JWT_ACCESS_SECRET must not start or end with whitespace",
  })
  // A cheap guard against "aaaaaaaa..." and keyboard patterns. Random base64 or hex easily has 12
  // or more different characters; a 48-byte base64 secret has about 50.
  .refine((value) => new Set(value).size >= MIN_DISTINCT_SECRET_CHARACTERS, {
    message: "JWT_ACCESS_SECRET is too repetitive; generate a random one (see .env.example)",
  });

const envSchema = z
  .object({
    NODE_ENV: nodeEnvSchema,
    API_HOST: z.string().min(1).default("127.0.0.1"),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: databaseUrlSchema,
    JWT_ACCESS_SECRET: jwtSecretSchema,
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    // Not z.coerce: an empty string would coerce to 0 and silently switch the grace window off.
    REFRESH_REUSE_GRACE_SECONDS: z
      .string()
      .regex(/^\d+$/, "REFRESH_REUSE_GRACE_SECONDS must be a whole number of seconds")
      .default("10")
      .transform(Number)
      .pipe(z.number().int().min(0).max(60)),
    CORS_ORIGINS: z.string().optional(),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(100),
    RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(60),
  })
  .transform((raw, ctx) => {
    const { CORS_ORIGINS: rawOrigins, ...rest } = raw;
    let corsOrigins: readonly string[] = DEFAULT_DEV_CORS_ORIGINS;

    // The placeholder is public (it is in .env.example), so a server using it has forgeable
    // tokens. Only the test suite may use it. A staging copy started with NODE_ENV=development
    // is just as exposed as a production one, which is why development is refused too.
    if (
      rest.NODE_ENV !== "test" &&
      rest.JWT_ACCESS_SECRET.toLowerCase().startsWith(SECRET_PLACEHOLDER_PREFIX)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["JWT_ACCESS_SECRET"],
        message:
          "JWT_ACCESS_SECRET still has the placeholder value from .env.example; generate a real one",
      });
      return z.NEVER;
    }

    if (rawOrigins !== undefined) {
      const parsed = rawOrigins.split(",").map((entry) => parseOrigin(entry.trim()));
      const origins = parsed.filter((origin): origin is string => origin !== undefined);
      if (origins.length !== parsed.length) {
        ctx.addIssue({
          code: "custom",
          path: ["CORS_ORIGINS"],
          message:
            "CORS_ORIGINS must be a comma-separated list of origins such as https://app.example.com (no wildcard, path or credentials)",
        });
        return z.NEVER;
      }
      if (
        rest.NODE_ENV === "production" &&
        origins.some((origin) => !origin.startsWith("https://"))
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["CORS_ORIGINS"],
          message: "CORS_ORIGINS must use https:// origins in production",
        });
        return z.NEVER;
      }
      corsOrigins = [...new Set(origins)];
    } else if (rest.NODE_ENV === "production") {
      ctx.addIssue({
        code: "custom",
        path: ["CORS_ORIGINS"],
        message: "CORS_ORIGINS is required in production",
      });
      return z.NEVER;
    }

    return { ...rest, CORS_ORIGINS: corsOrigins };
  });

export type Env = z.infer<typeof envSchema>;

const databaseEnvSchema = z.object({ NODE_ENV: nodeEnvSchema, DATABASE_URL: databaseUrlSchema });

export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;

/** Raised when environment variables are missing or invalid. */
export class EnvValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

/**
 * Validates raw environment variables and returns a typed config.
 * Fails fast with an {@link EnvValidationError} listing every problem.
 * Issue messages never include the offending values, so secrets are not leaked into logs.
 */
export function loadEnv(source: Readonly<Record<string, string | undefined>>): Env {
  return parseEnv(envSchema, source);
}

/**
 * The small subset that tools such as the migration CLI need. They must not demand secrets they
 * never use, so they do not go through {@link loadEnv}.
 */
export function loadDatabaseEnv(source: Readonly<Record<string, string | undefined>>): DatabaseEnv {
  return parseEnv(databaseEnvSchema, source);
}

function parseEnv<T>(
  schema: z.ZodType<T>,
  source: Readonly<Record<string, string | undefined>>,
): T {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }
  return result.data;
}
