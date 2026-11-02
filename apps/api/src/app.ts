import type { Writable } from "node:stream";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { HashGate } from "./auth/hash-gate.ts";
import { type AuthLimits, DEFAULT_AUTH_LIMITS } from "./auth/limits.ts";
import { createPasswordHasher, type PasswordHasher } from "./auth/password.ts";
import { type AuthService, createAuthService } from "./auth/service.ts";
import { createAccessTokens, createCsrfTokens } from "./auth/tokens.ts";
import type { Env } from "./config/env.ts";
import { buildLoggerOptions } from "./config/logger.ts";
import type { Database, DatabaseHandle } from "./db/client.ts";
import { frameworkErrorHandler, registerErrorHandling } from "./errors/error-handler.ts";
import { registerOpenApi } from "./plugins/openapi.ts";
import { registerSecurity } from "./plugins/security.ts";
import { authRoutes } from "./routes/auth.ts";
import { healthRoutes } from "./routes/health.ts";

declare module "fastify" {
  interface FastifyInstance {
    /** Drizzle database instance. Its pool is closed when the app closes. */
    db: Database;
    /** Sign-up, login, refresh and logout. Use `requireAuth` for protected routes. */
    auth: AuthService;
  }

  interface FastifyRequest {
    /** The signed-in user's id. Set by `requireAuth`; `null` on routes that do not use it. */
    userId: string | null;
  }
}

/** Largest accepted request body. Fastify's default, made explicit. */
const BODY_LIMIT_BYTES = 1_048_576;

/** A login ends after this long however often it is renewed. */
const REFRESH_ABSOLUTE_DAYS = 90;

export interface AppDependencies {
  /** The app takes ownership: `app.close()` ends the pool. */
  readonly database: DatabaseHandle;
  /** Receives log output. Used by tests to assert on what is (not) logged. */
  readonly logStream?: Writable;
  /** Replaces the password hasher. Tests use cheap settings so they run fast. */
  readonly passwordHasher?: PasswordHasher;
  /** Replaces the limits on the auth routes. Tests use them to reach a limit quickly. */
  readonly authLimits?: AuthLimits;
}

/** Builds the Fastify app without listening, so tests can use `app.inject()`. */
export function buildApp(env: Env, deps: AppDependencies): FastifyInstance {
  const app = Fastify({
    logger: buildLoggerOptions(env, deps.logStream),
    bodyLimit: BODY_LIMIT_BYTES,
    frameworkErrors: frameworkErrorHandler,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

  // text/plain is a CORS-safelisted content type, so a cross-site page can send it without a
  // preflight. The API speaks JSON only: anything else is answered with 415.
  app.removeContentTypeParser("text/plain");

  app.decorate("db", deps.database.db);
  app.addHook("onClose", async () => {
    await deps.database.close();
  });

  const auth = createAuthService({
    db: deps.database.db,
    hasher: deps.passwordHasher ?? createPasswordHasher({ gate: new HashGate() }),
    accessTokens: createAccessTokens({
      secret: env.JWT_ACCESS_SECRET,
      ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
    }),
    csrf: createCsrfTokens(env.JWT_ACCESS_SECRET),
    config: {
      refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
      refreshAbsoluteDays: REFRESH_ABSOLUTE_DAYS,
      refreshGraceSeconds: env.REFRESH_REUSE_GRACE_SECONDS,
    },
    onSecurityEvent: (event) => {
      app.log.warn(
        { event: `auth.${event.type}`, userId: event.userId, familyId: event.familyId },
        "A refresh token was used again after it had been replaced. The login was revoked.",
      );
    },
    onError: (error) => {
      app.log.error({ err: error }, "A non-fatal auth error happened");
    },
  });
  app.decorate("auth", auth);
  app.decorateRequest("userId", null);

  // Order matters. The rate limit attaches to routes through an onRoute hook, and a child scope
  // keeps only the hooks that existed when it was created. So security comes first, which makes
  // the docs routes (registered by OpenAPI) rate limited too. All of it comes before the routes.
  registerSecurity(app, env);
  registerOpenApi(app);
  app.register(cookie);

  app.register(healthRoutes);
  app.register(authRoutes, {
    prefix: "/auth",
    auth,
    allowedOrigins: env.CORS_ORIGINS,
    // Browsers refuse Secure cookies on plain http, which local development uses.
    cookies: { secure: env.NODE_ENV === "production" },
    limits: deps.authLimits ?? DEFAULT_AUTH_LIMITS,
  });

  return app;
}
