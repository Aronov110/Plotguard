import { afterEach, describe, expect, it } from "vitest";
import {
  type AuthTestApp,
  buildAuthTestApp,
  CookieJar,
  csrfOf,
  findCookie,
  PASSWORD,
  type SessionJson,
  setCookies,
} from "../../test-support/auth-app.ts";

/**
 * In production the cookies carry the `__Host-` prefix. A browser refuses to store a cookie with
 * that prefix unless it is Secure, has Path=/ and has no Domain, and it refuses one set by another
 * host. That stops a sibling subdomain from planting a cookie of its own (cookie tossing) to log
 * the visitor in as the attacker.
 */
const PROD_ORIGIN = "https://app.example.com";
const PROD_ENV = { NODE_ENV: "production", CORS_ORIGINS: PROD_ORIGIN } as const;

let t: AuthTestApp;
afterEach(async () => {
  await t.close();
});

async function prodSignUp() {
  const response = await t.app.inject({
    method: "POST",
    url: "/auth/register",
    headers: { origin: PROD_ORIGIN },
    payload: { email: "mara@example.com", password: PASSWORD },
  });
  const jar = new CookieJar();
  jar.update(response);
  return { response, jar, body: response.json<SessionJson>() };
}

const prodPost = (url: string, jar: CookieJar, extra: Record<string, string> = {}) =>
  t.app.inject({
    method: "POST",
    url,
    headers: { origin: PROD_ORIGIN, cookie: jar.header, "x-csrf-token": csrfOf(jar), ...extra },
  });

describe("cookies in production", () => {
  it("use the __Host- names, and only those", async () => {
    t = await buildAuthTestApp({ env: PROD_ENV });
    const { response } = await prodSignUp();
    expect(
      setCookies(response)
        .map((c) => c.name)
        .sort(),
    ).toEqual(["__Host-csrf_token", "__Host-refresh_token"]);
  });

  it("meet every rule of the __Host- prefix", async () => {
    t = await buildAuthTestApp({ env: PROD_ENV });
    const { response } = await prodSignUp();
    for (const name of ["__Host-refresh_token", "__Host-csrf_token"]) {
      const cookie = findCookie(response, name);
      expect(cookie?.attributes, name).toMatchObject({
        secure: true,
        path: "/",
        samesite: "Strict",
      });
      expect(cookie?.attributes, name).not.toHaveProperty("domain");
    }
  });

  it("keep the refresh cookie locked and the CSRF cookie readable", async () => {
    t = await buildAuthTestApp({ env: PROD_ENV });
    const { response } = await prodSignUp();
    expect(findCookie(response, "__Host-refresh_token")?.attributes).toHaveProperty(
      "httponly",
      true,
    );
    expect(findCookie(response, "__Host-csrf_token")?.attributes).not.toHaveProperty("httponly");
  });

  it("work through the whole story: refresh, who am I, logout", async () => {
    t = await buildAuthTestApp({ env: PROD_ENV });
    const { jar, body } = await prodSignUp();

    const refreshed = await prodPost("/auth/refresh", jar);
    expect(refreshed.statusCode).toBe(200);
    jar.update(refreshed);

    const me = await t.app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${refreshed.json().accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.id).toBe(body.user.id);

    const loggedOut = await prodPost("/auth/logout", jar);
    expect(loggedOut.statusCode).toBe(204);
    expect((await prodPost("/auth/refresh", jar)).statusCode).toBe(401);
  });

  it("are cleared on logout with the same prefix, path and flags", async () => {
    t = await buildAuthTestApp({ env: PROD_ENV });
    const { jar } = await prodSignUp();
    const response = await prodPost("/auth/logout", jar);
    for (const name of ["__Host-refresh_token", "__Host-csrf_token"]) {
      const cookie = findCookie(response, name);
      expect(cookie?.value, name).toBe("");
      expect(cookie?.attributes, name).toMatchObject({ "max-age": "0", secure: true, path: "/" });
    }
  });

  it("keep their lifetime in step with the login", async () => {
    t = await buildAuthTestApp({ env: PROD_ENV });
    const { response } = await prodSignUp();
    const refreshAge = Number(findCookie(response, "__Host-refresh_token")?.attributes["max-age"]);
    const csrfAge = Number(findCookie(response, "__Host-csrf_token")?.attributes["max-age"]);
    expect(refreshAge).toBe(csrfAge);
    expect(Math.abs(refreshAge - 30 * 24 * 3600)).toBeLessThan(120);
  });

  describe("a cookie planted under the plain name", () => {
    it("is ignored by refresh, even if it holds a perfectly valid token", async () => {
      t = await buildAuthTestApp({ env: PROD_ENV });
      const { jar } = await prodSignUp();
      const response = await t.app.inject({
        method: "POST",
        url: "/auth/refresh",
        headers: {
          origin: PROD_ORIGIN,
          cookie: `refresh_token=${jar.get("__Host-refresh_token")}; csrf_token=${csrfOf(jar)}`,
          "x-csrf-token": csrfOf(jar),
        },
      });
      expect(response.statusCode).toBe(401);
    });

    it("does not let logout end a login", async () => {
      t = await buildAuthTestApp({ env: PROD_ENV });
      const { jar } = await prodSignUp();
      await t.app.inject({
        method: "POST",
        url: "/auth/logout",
        headers: {
          origin: PROD_ORIGIN,
          cookie: `refresh_token=${jar.get("__Host-refresh_token")}`,
        },
      });
      expect((await prodPost("/auth/refresh", jar)).statusCode).toBe(200);
    });

    it("does not replace the real cookie when both are sent", async () => {
      t = await buildAuthTestApp({ env: PROD_ENV });
      const { jar } = await prodSignUp();
      const response = await t.app.inject({
        method: "POST",
        url: "/auth/refresh",
        headers: {
          origin: PROD_ORIGIN,
          cookie: `refresh_token=${"A".repeat(43)}; ${jar.header}`,
          "x-csrf-token": csrfOf(jar),
        },
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe("outside production", () => {
    it("keep the plain names, which browsers accept over plain http", async () => {
      t = await buildAuthTestApp();
      const response = await t.app.inject({
        method: "POST",
        url: "/auth/register",
        headers: { origin: "http://localhost:5173" },
        payload: { email: "mara@example.com", password: PASSWORD },
      });
      expect(
        setCookies(response)
          .map((c) => c.name)
          .sort(),
      ).toEqual(["csrf_token", "refresh_token"]);
    });
  });
});
