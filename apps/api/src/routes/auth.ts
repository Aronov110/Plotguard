import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  type CookieSettings,
  clearAuthCookies,
  cookieNames,
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
import { RATE_LIMIT_CACHE_SIZE } from "../plugins/security.ts";

/** Auth bodies are a few hundred bytes. The global limit of 1 MiB would let a lot of junk in. */
const AUTH_BODY_LIMIT_BYTES = 4096;

export interface AuthRoutesOptions {
  readonly auth: AuthService;
  readonly allowedOrigins: readonly string[];
  readonly cookies: CookieSettings;
  readonly limits: AuthLimits;
}

const COOKIE_NOTE =
  "Needs the refresh cookie (`refresh_token`, or `__Host-refresh_token` in production; set by " +
  "sign-up and login, and sent by the browser by itself), the CSRF code in an `X-CSRF-Token` " +
  "header (copy it from the `csrf_token` / `__Host-csrf_token` cookie), and an `Origin` header " +
  "that is on the server's list. Send no body.";

/**
 * A rate-limit rule in the shape the limiter wants. The cache size is set on EVERY rule: each
 * route-level limiter gets its own store, and a store left to its default holds only 5,000 keys,
 * so 5,000 junk requests would push a victim's counter out and reset it.
 */
const rule = (limit: RateRule) => ({
  max: limit.max,
  timeWindow: limit.windowSeconds * 1000,
  cache: RATE_LIMIT_CACHE_SIZE,
});

function sessionBody(result: AuthResult) {
  return { user: result.user, accessToken: result.accessToken, expiresIn: result.expiresIn };
}

/** The email in a login body, normalised. Empty if the body has none (validation runs first). */
function bodyEmail(request: FastifyRequest): string {
  const body = request.body;
  return typeof body === "object" &&
    body !== null &&
    "email" in body &&
    typeof body.email === "string"
    ? normalizeEmail(body.email)
    : "";
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Key for one email from anywhere. Hashed, so no email address is kept in memory as a key. */
const emailKey = (request: FastifyRequest) => sha256(`email:${bodyEmail(request)}`);

/** Key for one email from one address. */
const emailAndAddressKey = (request: FastifyRequest) =>
  sha256(`pair:${bodyEmail(request)}\0${request.ip}`);

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
  const names = cookieNames(cookies);
  const typed = app.withTypeProvider<ZodTypeProvider>();
  // `preValidation`, not `onRequest`: the rate limiter is a route-level `onRequest` hook, which
  // runs before this one, so a request with a forged Origin is counted against its address too.
  const originGuard = createOriginGuard(options.allowedOrigins);
  const requireAuth = createRequireAuth(auth);

  // Sign-in answers must never be stored by a browser or a proxy.
  app.addHook("onSend", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    reply.header("pragma", "no-cache");
  });

  // Two counters of FAILED logins, kept apart from the per-address limiter. They are created with
  // `createRateLimit` and called by hand, because the per-address limiter marks the request as
  // counted and would silently switch a second route-level limiter off.
  const failuresPerPair = app.createRateLimit({
    ...rule(limits.loginFailuresPerEmailAndIp),
    keyGenerator: emailAndAddressKey,
  });
  const failuresPerEmail = app.createRateLimit({
    ...rule(limits.loginFailuresPerEmail),
    keyGenerator: emailKey,
  });

  /** Seconds until a blocked login may try again, or `undefined` when it may go ahead. */
  async function loginBlockedFor(request: FastifyRequest): Promise<number | undefined> {
    let wait: number | undefined;
    for (const counter of [failuresPerPair, failuresPerEmail]) {
      // Reading does not count. Only a failed password adds to the total (see recordLoginFailure).
      const state = await counter(request, { increment: false });
      if (!state.isAllowed && state.remaining === 0) {
        wait = Math.max(wait ?? 0, state.ttlInSeconds);
      }
    }
    return wait;
  }

  async function recordLoginFailure(request: FastifyRequest): Promise<void> {
    await failuresPerPair(request);
    await failuresPerEmail(request);
  }

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
      preValidation: [originGuard],
      config: { rateLimit: rule(limits.register) },
      schema: {
        tags: ["auth"],
        summary: "Create an account and sign in",
        description:
          "Needs an `Origin` header that is on the server's list. Answers 409 if the email is " +
          "already registered. Sets the refresh and CSRF cookies.",
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
      preValidation: [originGuard],
      config: { rateLimit: rule(limits.login) },
      preHandler: async (request: FastifyRequest) => {
        const wait = await loginBlockedFor(request);
        if (wait !== undefined) throw new RateLimitError(wait);
      },
      schema: {
        tags: ["auth"],
        summary: "Sign in",
        description:
          "Needs an `Origin` header that is on the server's list. Every failure answers 401 with " +
          "the same message, so it never says whether the email exists. Too many FAILED " +
          "attempts for one email (from one address, or from anywhere) answer 429; correct " +
          "logins never count towards that. Sets the refresh and CSRF cookies.",
        body: loginBodySchema,
        response: { 200: sessionResponseSchema },
      },
    },
    async (request, reply) => {
      let result: AuthResult;
      try {
        result = await auth.login(request.body);
      } catch (error) {
        if (error instanceof UnauthorizedError) await recordLoginFailure(request);
        throw error;
      }
      setAuthCookies(reply, result, cookies);
      return reply.status(200).send(sessionBody(result));
    },
  );

  typed.post(
    "/refresh",
    {
      preValidation: [originGuard],
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
      const token = request.cookies[names.refresh];
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
      preValidation: [originGuard],
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
      const token = request.cookies[names.refresh];
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
