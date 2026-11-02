import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  type CookieSettings,
  clearAuthCookies,
  REFRESH_COOKIE,
  setAuthCookies,
} from "../auth/cookies.ts";
import { normalizeEmail } from "../auth/credentials.ts";
import type { AuthLimits, RateRule } from "../auth/limits.ts";
import { createOriginGuard } from "../auth/origin-guard.ts";
import { createRequireAuth } from "../auth/require-auth.ts";
import {
  loginBodySchema,
  meResponseSchema,
  registerBodySchema,
  sessionResponseSchema,
} from "../auth/schemas.ts";
import { type AuthResult, type AuthService, SESSION_EXPIRED } from "../auth/service.ts";
import { ForbiddenError, RateLimitError, UnauthorizedError } from "../errors/app-error.ts";

/** Auth bodies are a few hundred bytes. The global limit of 1 MiB would let a lot of junk in. */
const AUTH_BODY_LIMIT_BYTES = 4096;

export interface AuthRoutesOptions {
  readonly auth: AuthService;
  readonly allowedOrigins: readonly string[];
  readonly cookies: CookieSettings;
  readonly limits: AuthLimits;
}

const COOKIE_NOTE =
  "Needs the `refresh_token` cookie (set by sign-up and login; the browser sends it by itself), " +
  "the CSRF code in an `X-CSRF-Token` header (copy it from the `csrf_token` cookie), and an " +
  "`Origin` header that is on the server's list. Send no body.";

const rule = (limit: RateRule) => ({ max: limit.max, timeWindow: limit.windowSeconds * 1000 });

function sessionBody(result: AuthResult) {
  return { user: result.user, accessToken: result.accessToken, expiresIn: result.expiresIn };
}

/** The email in a login body, normalised and hashed, as the key of the per-email limit. */
function emailKey(request: FastifyRequest): string {
  const body = request.body;
  const email =
    typeof body === "object" && body !== null && "email" in body && typeof body.email === "string"
      ? normalizeEmail(body.email)
      : "";
  return createHash("sha256").update(email).digest("hex");
}

function csrfHeader(request: FastifyRequest): string | undefined {
  const value = request.headers["x-csrf-token"];
  return typeof value === "string" ? value : undefined;
}

/**
 * The five auth routes. Register this under the `/auth` prefix, after the cookie plugin.
 *
 * Three layers protect the routes that change state: the `Origin` must be on the allowlist, the
 * cookie must be SameSite=Strict, and the two routes that rely on the refresh cookie also need the
 * CSRF code in a header, which a page on another site cannot read.
 */
export async function authRoutes(app: FastifyInstance, options: AuthRoutesOptions): Promise<void> {
  const { auth, cookies, limits } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const originGuard = createOriginGuard(options.allowedOrigins);
  const requireAuth = createRequireAuth(auth);

  // Sign-in answers must never be stored by a browser or a proxy.
  app.addHook("onSend", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    reply.header("pragma", "no-cache");
  });

  // Counts login attempts per email address. `createRateLimit` is used instead of a route hook
  // because the per-address limiter has already marked the request as counted.
  const perEmail = app.createRateLimit({
    ...rule(limits.loginPerEmail),
    keyGenerator: emailKey,
  });

  /** For the two routes that rely on the refresh cookie. */
  async function checkCsrf(request: FastifyRequest, familyId: string): Promise<void> {
    if (!auth.verifyCsrf(familyId, csrfHeader(request))) {
      throw new ForbiddenError("The CSRF token is missing or wrong.");
    }
  }

  typed.post(
    "/register",
    {
      bodyLimit: AUTH_BODY_LIMIT_BYTES,
      onRequest: [originGuard],
      config: { rateLimit: rule(limits.register) },
      schema: {
        tags: ["auth"],
        summary: "Create an account and sign in",
        description:
          "Needs an `Origin` header that is on the server's list. Answers 409 if the email is " +
          "already registered. Sets the `refresh_token` and `csrf_token` cookies.",
        body: registerBodySchema,
        response: { 201: sessionResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await auth.register(request.body);
      setAuthCookies(reply, result, cookies);
      return reply.status(201).send(sessionBody(result));
    },
  );

  typed.post(
    "/login",
    {
      bodyLimit: AUTH_BODY_LIMIT_BYTES,
      onRequest: [originGuard],
      config: { rateLimit: rule(limits.login) },
      preHandler: async (request: FastifyRequest) => {
        const result = await perEmail(request);
        // The other shape of the result means "on the allow list", which has no limit to exceed.
        if (!result.isAllowed && result.isExceeded) throw new RateLimitError(result.ttlInSeconds);
      },
      schema: {
        tags: ["auth"],
        summary: "Sign in",
        description:
          "Needs an `Origin` header that is on the server's list. Every failure answers 401 with " +
          "the same message, so it never says whether the email exists. Sets the `refresh_token` " +
          "and `csrf_token` cookies.",
        body: loginBodySchema,
        response: { 200: sessionResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await auth.login(request.body);
      setAuthCookies(reply, result, cookies);
      return reply.status(200).send(sessionBody(result));
    },
  );

  typed.post(
    "/refresh",
    {
      onRequest: [originGuard],
      config: { rateLimit: rule(limits.refresh) },
      schema: {
        tags: ["auth"],
        summary: "Get a new access token",
        description:
          `${COOKIE_NOTE} Swaps the refresh token for a new one (the old one stops working) and ` +
          "answers with a fresh access token. Answers 401 if the cookie is missing or no longer " +
          "valid, and 403 if the CSRF code or the origin is wrong.",
        response: { 200: sessionResponseSchema },
      },
    },
    async (request, reply) => {
      const token = request.cookies[REFRESH_COOKIE];
      const identified = token === undefined ? undefined : await auth.identifyRefreshToken(token);
      if (token === undefined || identified === undefined) {
        // The cookies are left alone on purpose. A second tab that lost a refresh race lands here,
        // and clearing would delete the new cookie that the winning tab has just received.
        throw new UnauthorizedError(SESSION_EXPIRED);
      }
      await checkCsrf(request, identified.familyId);
      const result = await auth.refresh(token);
      setAuthCookies(reply, result, cookies);
      return reply.status(200).send(sessionBody(result));
    },
  );

  typed.post(
    "/logout",
    {
      onRequest: [originGuard],
      config: { rateLimit: rule(limits.logout) },
      schema: {
        tags: ["auth"],
        summary: "Sign out",
        description:
          `${COOKIE_NOTE} Ends this login on the server and clears both cookies. Safe to call ` +
          "twice, and with no cookie at all.",
        response: { 204: z.null().describe("Signed out.") },
      },
    },
    async (request, reply: FastifyReply) => {
      const token = request.cookies[REFRESH_COOKIE];
      const identified = token === undefined ? undefined : await auth.identifyRefreshToken(token);
      // Only a login that exists needs the CSRF check: signing out of nothing changes nothing.
      if (identified !== undefined) await checkCsrf(request, identified.familyId);
      await auth.logout(token);
      clearAuthCookies(reply, cookies);
      return reply.status(204).send();
    },
  );

  typed.get(
    "/me",
    {
      preHandler: requireAuth,
      schema: {
        tags: ["auth"],
        summary: "Who am I",
        description:
          "The signed-in user. Needs the access token in an `Authorization: Bearer` header.",
        security: [{ bearerAuth: [] }],
        response: { 200: meResponseSchema },
      },
    },
    async (request) => {
      if (request.userId === null) throw new UnauthorizedError();
      return { user: await auth.me(request.userId) };
    },
  );
}
