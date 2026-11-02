import type { FastifyReply } from "fastify";

export interface CookieSettings {
  /** True in production. Browsers refuse Secure cookies on plain http, which dev uses. */
  readonly secure: boolean;
}

export interface CookieNames {
  readonly refresh: string;
  readonly csrf: string;
}

/**
 * The cookie names. In production they start with `__Host-`: a browser then refuses to store the
 * cookie unless it is Secure, has Path=/ and has no Domain, and it refuses one that another host
 * (say, a sibling subdomain an attacker controls) tries to set. That stops "cookie tossing", where
 * an attacker plants their own login cookies in a visitor's browser. The prefix needs Secure, which
 * browsers refuse over plain http, so development uses the plain names.
 */
export function cookieNames(settings: CookieSettings): CookieNames {
  return settings.secure
    ? { refresh: "__Host-refresh_token", csrf: "__Host-csrf_token" }
    : { refresh: "refresh_token", csrf: "csrf_token" };
}

/**
 * Where the cookies are sent. The refresh cookie is limited to the auth routes, except in
 * production, where the `__Host-` prefix demands Path=/. That is acceptable because the cookie is
 * HttpOnly and SameSite=Strict, and only the auth routes read it.
 */
function paths(settings: CookieSettings): { refresh: string; csrf: string } {
  return { refresh: settings.secure ? "/" : "/auth", csrf: "/" };
}

export interface SessionCookies {
  readonly refreshToken: string;
  readonly refreshExpiresAt: Date;
  readonly csrfToken: string;
}

/**
 * Sets the two login cookies. Neither has a `Domain`, so each belongs to this exact host only.
 * Both are SameSite=Strict, so a browser never attaches them to a request that starts on another
 * site. Only the refresh cookie is HttpOnly: the CSRF code has to be readable by the web app.
 */
export function setAuthCookies(
  reply: FastifyReply,
  session: SessionCookies,
  settings: CookieSettings,
  now: Date = new Date(),
): void {
  const names = cookieNames(settings);
  const where = paths(settings);
  const maxAge = Math.max(
    1,
    Math.floor((session.refreshExpiresAt.getTime() - now.getTime()) / 1000),
  );
  reply.setCookie(names.refresh, session.refreshToken, {
    httpOnly: true,
    sameSite: "strict",
    secure: settings.secure,
    path: where.refresh,
    maxAge,
  });
  reply.setCookie(names.csrf, session.csrfToken, {
    httpOnly: false,
    sameSite: "strict",
    secure: settings.secure,
    path: where.csrf,
    maxAge,
  });
}

/** Removes both cookies. They must be cleared with the same path and flags they were set with. */
export function clearAuthCookies(reply: FastifyReply, settings: CookieSettings): void {
  const names = cookieNames(settings);
  const where = paths(settings);
  reply.setCookie(names.refresh, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: settings.secure,
    path: where.refresh,
    maxAge: 0,
  });
  reply.setCookie(names.csrf, "", {
    httpOnly: false,
    sameSite: "strict",
    secure: settings.secure,
    path: where.csrf,
    maxAge: 0,
  });
}
