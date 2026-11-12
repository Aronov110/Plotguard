import type { Writable } from "node:stream";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { createAnthropicAiClient } from "./ai/anthropic-client.ts";
import type { AiClient } from "./ai/client.ts";
import { type AiConfig, aiConfigFromEnv } from "./ai/limits.ts";
import { type AiService, createAiService } from "./ai/service.ts";
import { HashGate } from "./auth/hash-gate.ts";
import { type AuthLimits, DEFAULT_AUTH_LIMITS } from "./auth/limits.ts";
import { createPasswordHasher, type PasswordHasher } from "./auth/password.ts";
import { type AuthService, createAuthService } from "./auth/service.ts";
import { createAccessTokens, createCsrfTokens } from "./auth/tokens.ts";
import type { Env } from "./config/env.ts";
import { buildLoggerOptions } from "./config/logger.ts";
import type { Database, DatabaseHandle } from "./db/client.ts";
import { DEFAULT_DOCUMENT_LIMITS, type DocumentLimits } from "./documents/limits.ts";
import { createDocumentsService } from "./documents/service.ts";
import { frameworkErrorHandler, registerErrorHandling } from "./errors/error-handler.ts";
import { registerOpenApi } from "./plugins/openapi.ts";
import { registerSecurity } from "./plugins/security.ts";
import { DEFAULT_PROJECT_LIMITS, type ProjectLimits } from "./projects/limits.ts";
import { createProjectsService } from "./projects/service.ts";
import { analysesRoutes } from "./routes/analyses.ts";
import { authRoutes } from "./routes/auth.ts";
import { documentsRoutes } from "./routes/documents.ts";
import { healthRoutes } from "./routes/health.ts";
import { projectsRoutes } from "./routes/projects.ts";

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
  /** Replaces the limits on the project routes. Tests use them to reach a limit quickly. */
  readonly projectLimits?: ProjectLimits;
  /** Replaces the limits on the document routes. Tests use them to reach a limit quickly. */
  readonly documentLimits?: DocumentLimits;
  /** How long a document change waits for the project lock. Tests use a short time. */
  readonly documentLockTimeoutMs?: number;
  /**
   * Replaces the model call. Only test code passes this (a fake that makes no network call and costs
   * nothing); a running server builds the real one from `ANTHROPIC_API_KEY`, and there is no
   * setting that switches the fake on.
   */
  readonly aiClient?: AiClient;
  /** Replaces the AI limits. Tests use them to reach a limit quickly. */
  readonly aiConfig?: AiConfig;
  /**
   * Fails the runs a restart left `pending` when the app is ready. Only the real server sets it: the
   * runs live inside one process, so each process that starts may sweep what the last one left.
   */
  readonly aiSweepOnStart?: boolean;
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
  // Set below. A run in progress needs the database, so the close stops the runs and waits for them
  // to be written down first.
  let ai: AiService | undefined;
  app.addHook("onClose", async () => {
    await ai?.shutdown();
    await deps.database.close();
  });

  const hasher = deps.passwordHasher ?? createPasswordHasher({ gate: new HashGate() });
  // Make the dummy hash (used for unknown emails) before the first request, so that the first
  // login for an unknown email is not slower than the others. A failure here is not fatal: the
  // hasher tries again on first use.
  app.addHook("onReady", async () => {
    try {
      await hasher.warmUp();
    } catch (error) {
      app.log.error({ err: error }, "Could not prepare the password hasher at startup");
    }
  });

  const auth = createAuthService({
    db: deps.database.db,
    hasher,
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
  app.register(projectsRoutes, {
    prefix: "/projects",
    auth,
    projects: createProjectsService(deps.database.db),
    limits: deps.projectLimits ?? DEFAULT_PROJECT_LIMITS,
  });
  const aiConfig = deps.aiConfig ?? aiConfigFromEnv(env);
  const aiClient =
    deps.aiClient ??
    (env.ANTHROPIC_API_KEY === undefined
      ? undefined
      : createAnthropicAiClient({ apiKey: env.ANTHROPIC_API_KEY }));
  const aiService = createAiService(deps.database.db, {
    client: aiClient,
    config: aiConfig,
    enabled: env.AI_ENABLED,
    onUnexpectedError: (details) => {
      app.log.error(details, "An AI run failed unexpectedly");
    },
  });
  ai = aiService;
  if (deps.aiSweepOnStart === true) {
    app.addHook("onReady", async () => {
      const swept = await aiService.sweepInterrupted();
      if (swept > 0)
        app.log.warn({ swept }, "AI runs left running by a restart were marked failed");
    });
  }
  app.register(analysesRoutes, {
    prefix: "/projects/:projectId/analyses",
    auth,
    ai: aiService,
    config: aiConfig,
  });
  app.register(documentsRoutes, {
    prefix: "/projects/:projectId/documents",
    auth,
    documents: createDocumentsService(
      deps.database.db,
      deps.documentLockTimeoutMs === undefined ? {} : { lockTimeoutMs: deps.documentLockTimeoutMs },
    ),
    limits: deps.documentLimits ?? DEFAULT_DOCUMENT_LIMITS,
  });

  return app;
}
