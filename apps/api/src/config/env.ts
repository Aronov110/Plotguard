import { z } from "zod";

const DEFAULT_DEV_CORS_ORIGINS: readonly string[] = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
];

/** scheme://host[:port] only: no path, query, fragment, credentials or trailing slash. */
const ORIGIN_PATTERN = /^https?:\/\/[^/?#@\s]+$/i;

/** Returns the normalised origin, or undefined when the value is not a plain http(s) origin. */
function parseOrigin(value: string): string | undefined {
  if (!ORIGIN_PATTERN.test(value)) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    API_HOST: z.string().min(1).default("127.0.0.1"),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z
      .string()
      .url()
      .refine((value) => /^postgres(ql)?:\/\//.test(value), {
        message: "DATABASE_URL must start with postgres:// or postgresql://",
      }),
    CORS_ORIGINS: z.string().optional(),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(100),
    RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(60),
  })
  .transform((raw, ctx) => {
    const { CORS_ORIGINS: rawOrigins, ...rest } = raw;
    let corsOrigins: readonly string[] = DEFAULT_DEV_CORS_ORIGINS;

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
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }
  return result.data;
}
