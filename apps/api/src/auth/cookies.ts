import type { FastifyReply } from "fastify";

export const REFRESH_COOKIE = "refresh_token";
export const CSRF_COOKIE = "csrf_token";

/** The refresh cookie is sent only to the auth routes, never to the rest of the API. */
const REFRESH_COOKIE_PATH = "/auth";
/** The CSRF cookie must be readable by the page, and a page only sees cookies for its own path. */
const CSRF_COOKIE_PATH = "/";

export interface CookieSettings {
  /** True in production. Browsers refuse Secure cookies over plain http, which dev uses. */
  readonly secure: boolean;
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
  const maxAge = Math.max(
    1,
    Math.floor((session.refreshExpiresAt.getTime() - now.getTime()) / 1000),
  );
  reply.setCookie(REFRESH_COOKIE, session.refreshToken, {
    httpOnly: true,
    sameSite: "strict",
    secure: settings.secure,
    path: REFRESH_COOKIE_PATH,
    maxAge,
  });
  reply.setCookie(CSRF_COOKIE, session.csrfToken, {
    httpOnly: false,
    sameSite: "strict",
    secure: settings.secure,
    path: CSRF_COOKIE_PATH,
    maxAge,
  });
}

/** Removes both cookies. They must be cleared with the same path and flags they were set with. */
export function clearAuthCookies(reply: FastifyReply, settings: CookieSettings): void {
  reply.setCookie(REFRESH_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: settings.secure,
    path: REFRESH_COOKIE_PATH,
    maxAge: 0,
  });
  reply.setCookie(CSRF_COOKIE, "", {
    httpOnly: false,
    sameSite: "strict",
    secure: settings.secure,
    path: CSRF_COOKIE_PATH,
    maxAge: 0,
  });
}
