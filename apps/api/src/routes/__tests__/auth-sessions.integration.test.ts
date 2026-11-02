import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { users } from "../../db/schema/users.ts";
import {
  type AuthTestApp,
  buildAuthTestApp,
  CookieJar,
  findCookie,
  logIn,
  logOut,
  ORIGIN,
  refresh,
  setCookies,
  signUp,
} from "../../test-support/auth-app.ts";

const PROBLEM = /^application\/problem\+json/;

let t: AuthTestApp;
afterEach(async () => {
  await t.close();
});

async function jarFromLogin(): Promise<CookieJar> {
  const jar = new CookieJar();
  jar.update(await logIn(t.app));
  return jar;
}

describe("POST /auth/refresh", () => {
  it("answers 200 with a new access token and new cookies", async () => {
    t = await buildAuthTestApp();
    const { jar, body } = await signUp(t.app);
    const response = await refresh(t.app, jar);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: body.user,
      accessToken: expect.any(String),
      expiresIn: 900,
    });
    expect(response.json().accessToken).not.toBe(body.accessToken);
    expect(findCookie(response, "refresh_token")?.value).not.toBe(jar.get("refresh_token"));
    expect(findCookie(response, "refresh_token")?.attributes).toMatchObject({
      httponly: true,
      samesite: "Strict",
      path: "/auth",
    });
  });

  it("keeps the same CSRF code for the whole login", async () => {
    t = await buildAuthTestApp();
    const { jar } = await signUp(t.app);
    const response = await refresh(t.app, jar);
    expect(findCookie(response, "csrf_token")?.value).toBe(jar.get("csrf_token"));
  });

  it("can be repeated, each time with the newest cookie", async () => {
    t = await buildAuthTestApp();
    const { jar } = await signUp(t.app);
    for (let i = 0; i < 5; i++) {
      const response = await refresh(t.app, jar);
      expect(response.statusCode).toBe(200);
      jar.update(response);
    }
  });

  it("shortens the cookie lifetime when the login nears its absolute end", async () => {
    t = await buildAuthTestApp();
    const { jar } = await signUp(t.app);
    await t.handle.db.execute(
      sql`update refresh_sessions
          set created_at = now() - interval '85 days', expires_at = now() + interval '10 days'`,
    );
    const response = await refresh(t.app, jar);
    const maxAge = Number(findCookie(response, "refresh_token")?.attributes["max-age"]);
    expect(Math.abs(maxAge - 5 * 24 * 3600)).toBeLessThan(120);
  });

  describe("the old token", () => {
    it("is refused straight afterwards, without ending the login", async () => {
      t = await buildAuthTestApp();
      const { jar } = await signUp(t.app);
      const old = new CookieJar();
      old.set("refresh_token", jar.get("refresh_token") ?? "");
      old.set("csrf_token", jar.get("csrf_token") ?? "");

      const fresh = await refresh(t.app, jar);
      jar.update(fresh);

      const replay = await refresh(t.app, old);
      expect(replay.statusCode).toBe(401);
      expect(replay.headers["content-type"]).toMatch(PROBLEM);
      expect((await refresh(t.app, jar)).statusCode).toBe(200);
    });

    it("ends the whole login when it comes back after the grace window", async () => {
      t = await buildAuthTestApp();
      const { jar } = await signUp(t.app);
      const old = new CookieJar();
      old.set("refresh_token", jar.get("refresh_token") ?? "");
      old.set("csrf_token", jar.get("csrf_token") ?? "");
      jar.update(await refresh(t.app, jar));
      await t.handle.db.execute(
        sql`update refresh_sessions set revoked_at = now() - interval '5 minutes' where revoked_at is not null`,
      );

      expect((await refresh(t.app, old)).statusCode).toBe(401);
      expect((await refresh(t.app, jar)).statusCode).toBe(401);
    });

    it("logs the theft at warn level with ids and no tokens", async () => {
      t = await buildAuthTestApp();
      const { jar } = await signUp(t.app);
      const old = new CookieJar();
      old.set("refresh_token", jar.get("refresh_token") ?? "");
      old.set("csrf_token", jar.get("csrf_token") ?? "");
      jar.update(await refresh(t.app, jar));
      await t.handle.db.execute(
        sql`update refresh_sessions set revoked_at = now() - interval '5 minutes' where revoked_at is not null`,
      );
      await refresh(t.app, old);

      const entry = t.logs.entries.find((e) => e.event === "auth.refresh-reuse");
      expect(entry?.level).toBe(40);
      expect(entry).toMatchObject({ userId: expect.any(String), familyId: expect.any(String) });
      expect(t.logs.text).not.toContain(old.get("refresh_token") ?? "never");
    });

    it("does not log theft for a harmless second request inside the grace window", async () => {
      t = await buildAuthTestApp();
      const { jar } = await signUp(t.app);
      const old = new CookieJar();
      old.set("refresh_token", jar.get("refresh_token") ?? "");
      old.set("csrf_token", jar.get("csrf_token") ?? "");
      await refresh(t.app, jar);
      await refresh(t.app, old);
      expect(t.logs.entries.some((e) => e.event === "auth.refresh-reuse")).toBe(false);
    });
  });

  it("lets exactly one of several simultaneous refreshes win, and keeps the user signed in", async () => {
    t = await buildAuthTestApp();
    const { jar } = await signUp(t.app);
    const responses = await Promise.all(Array.from({ length: 8 }, () => refresh(t.app, jar)));

    const winners = responses.filter((r) => r.statusCode === 200);
    expect(winners).toHaveLength(1);
    expect(responses.filter((r) => r.statusCode === 401)).toHaveLength(7);
    for (const loser of responses.filter((r) => r.statusCode === 401)) {
      expect(setCookies(loser)).toHaveLength(0);
    }
    jar.update(winners[0] as (typeof responses)[number]);
    expect((await refresh(t.app, jar)).statusCode).toBe(200);
  });

  describe("without a usable cookie", () => {
    it("answers 401 when there is no cookie, and sets no cookies", async () => {
      t = await buildAuthTestApp();
      const response = await t.app.inject({
        method: "POST",
        url: "/auth/refresh",
        headers: { origin: ORIGIN },
      });
      expect(response.statusCode).toBe(401);
      expect(response.headers["content-type"]).toMatch(PROBLEM);
      expect(setCookies(response)).toHaveLength(0);
    });

    it.each([
      ["a short value", "abc"],
      ["a value with a plus sign", `${"a".repeat(42)}+`],
      ["a long value", "a".repeat(5000)],
      ["a value nobody issued", "A".repeat(43)],
      ["an empty value", ""],
      ["a value with quotes", `"${"a".repeat(43)}"`],
    ])("answers 401 for %s", async (_label, value) => {
      t = await buildAuthTestApp();
      const response = await t.app.inject({
        method: "POST",
        url: "/auth/refresh",
        headers: { origin: ORIGIN, cookie: `refresh_token=${value}`, "x-csrf-token": "x" },
      });
      expect(response.statusCode).toBe(401);
    });

    it("does not clear the cookies, so a lost race cannot wipe the winner's new cookie", async () => {
      t = await buildAuthTestApp();
      const { jar } = await signUp(t.app);
      jar.update(await refresh(t.app, jar));
      const stale = new CookieJar();
      stale.set("refresh_token", "A".repeat(43));
      stale.set("csrf_token", jar.get("csrf_token") ?? "");
      const response = await refresh(t.app, stale);
      expect(response.statusCode).toBe(401);
      expect(setCookies(response)).toHaveLength(0);
    });

    it("answers 401 for an expired session", async () => {
      t = await buildAuthTestApp();
      const { jar } = await signUp(t.app);
      await t.handle.db.execute(
        sql`update refresh_sessions
            set created_at = now() - interval '2 days', expires_at = now() - interval '1 day'`,
      );
      expect((await refresh(t.app, jar)).statusCode).toBe(401);
    });

    it("answers 401 once the user is deleted", async () => {
      t = await buildAuthTestApp();
      const { jar } = await signUp(t.app);
      await t.handle.db.delete(users);
      expect((await refresh(t.app, jar)).statusCode).toBe(401);
    });
  });

  describe("the Origin check", () => {
    it.each([
      ["no Origin header", {}],
      ["a foreign origin", { origin: "https://evil.example.com" }],
      ["the null origin", { origin: "null" }],
    ])("answers 403 with %s and does not use up the token", async (_label, headers) => {
      t = await buildAuthTestApp();
      const { jar } = await signUp(t.app);
      const response = await t.app.inject({
        method: "POST",
        url: "/auth/refresh",
        headers: { cookie: jar.header, "x-csrf-token": jar.get("csrf_token") ?? "", ...headers },
      });
      expect(response.statusCode).toBe(403);
      expect(response.headers["content-type"]).toMatch(PROBLEM);
      expect(setCookies(response)).toHaveLength(0);
      expect((await refresh(t.app, jar)).statusCode).toBe(200);
    });
  });

  describe("the CSRF check", () => {
    it("answers 403 when the header is missing, and does not use up the token", async () => {
      t = await buildAuthTestApp();
      const { jar } = await signUp(t.app);
      const response = await t.app.inject({
        method: "POST",
        url: "/auth/refresh",
        headers: { origin: ORIGIN, cookie: jar.header },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().detail).toBe("The CSRF token is missing or wrong.");
      expect((await refresh(t.app, jar)).statusCode).toBe(200);
    });

    it.each([
      ["wrong", "x".repeat(43)],
      ["empty", ""],
      ["too short", "abc"],
      ["too long", "a".repeat(44)],
      ["with a newline", "a\n"],
    ])("answers 403 when the header is %s", async (_label, value) => {
      t = await buildAuthTestApp();
      const { jar } = await signUp(t.app);
      const response = await refresh(t.app, jar, { "x-csrf-token": value });
      expect(response.statusCode).toBe(403);
    });

    it("answers 403 for the CSRF code of another login", async () => {
      t = await buildAuthTestApp();
      const first = await signUp(t.app);
      const other = await jarFromLogin();
      const response = await refresh(t.app, first.jar, {
        "x-csrf-token": other.get("csrf_token") ?? "",
      });
      expect(response.statusCode).toBe(403);
    });

    it("answers 403 when only the cookie is sent and the header is missing, the case of a cross-site form", async () => {
      t = await buildAuthTestApp();
      const { jar } = await signUp(t.app);
      const response = await t.app.inject({
        method: "POST",
        url: "/auth/refresh",
        headers: { origin: ORIGIN, cookie: `${jar.header}` },
      });
      expect(response.statusCode).toBe(403);
    });

    it("is checked after the cookie: a dead cookie gives 401, not 403", async () => {
      t = await buildAuthTestApp();
      const response = await t.app.inject({
        method: "POST",
        url: "/auth/refresh",
        headers: { origin: ORIGIN, cookie: `refresh_token=${"A".repeat(43)}` },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe("the request body", () => {
    it("accepts a request with no body", async () => {
      t = await buildAuthTestApp();
      const { jar } = await signUp(t.app);
      expect((await refresh(t.app, jar)).statusCode).toBe(200);
    });

    it("accepts an empty JSON object", async () => {
      t = await buildAuthTestApp();
      const { jar } = await signUp(t.app);
      const response = await refresh(t.app, jar, { "content-type": "application/json" });
      expect([200, 400]).toContain(response.statusCode);
    });

    it("ignores the Authorization header: it is the cookie that counts", async () => {
      t = await buildAuthTestApp();
      const { jar } = await signUp(t.app);
      const response = await refresh(t.app, jar, { authorization: "Bearer garbage" });
      expect(response.statusCode).toBe(200);
    });
  });

  it("limits refreshes per address", async () => {
    t = await buildAuthTestApp({ limits: { refresh: { max: 2, windowSeconds: 60 } } });
    const { jar } = await signUp(t.app);
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      const response = await refresh(t.app, jar);
      jar.update(response);
      statuses.push(response.statusCode);
    }
    expect(statuses).toEqual([200, 200, 429]);
  });
});

describe("POST /auth/logout", () => {
  it("answers 204, clears both cookies the way they were set, and ends the login", async () => {
    t = await buildAuthTestApp();
    const { jar } = await signUp(t.app);
    const response = await logOut(t.app, jar);

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    const refreshCookie = findCookie(response, "refresh_token");
    const csrfCookie = findCookie(response, "csrf_token");
    expect(refreshCookie?.value).toBe("");
    expect(refreshCookie?.attributes).toMatchObject({
      "max-age": "0",
      path: "/auth",
      samesite: "Strict",
      httponly: true,
    });
    expect(csrfCookie?.value).toBe("");
    expect(csrfCookie?.attributes).toMatchObject({ "max-age": "0", path: "/", samesite: "Strict" });

    expect((await refresh(t.app, jar)).statusCode).toBe(401);
  });

  it("ends the login even after the token was renewed", async () => {
    t = await buildAuthTestApp();
    const { jar } = await signUp(t.app);
    jar.update(await refresh(t.app, jar));
    expect((await logOut(t.app, jar)).statusCode).toBe(204);
    expect((await refresh(t.app, jar)).statusCode).toBe(401);
  });

  it("can be done twice", async () => {
    t = await buildAuthTestApp();
    const { jar } = await signUp(t.app);
    expect((await logOut(t.app, jar)).statusCode).toBe(204);
    expect((await logOut(t.app, jar)).statusCode).toBe(204);
  });

  it("answers 204 and clears the cookies even when there is no cookie", async () => {
    t = await buildAuthTestApp();
    const response = await t.app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { origin: ORIGIN },
    });
    expect(response.statusCode).toBe(204);
    expect(
      setCookies(response)
        .map((c) => c.name)
        .sort(),
    ).toEqual(["csrf_token", "refresh_token"]);
  });

  it("answers 204 for a cookie nobody issued", async () => {
    t = await buildAuthTestApp();
    const response = await t.app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { origin: ORIGIN, cookie: `refresh_token=${"A".repeat(43)}` },
    });
    expect(response.statusCode).toBe(204);
  });

  it("leaves the user's other logins alone", async () => {
    t = await buildAuthTestApp();
    const phone = await signUp(t.app);
    const laptop = await jarFromLogin();
    await logOut(t.app, phone.jar);
    expect((await refresh(t.app, laptop)).statusCode).toBe(200);
  });

  describe("protection against forged requests", () => {
    it("answers 403 without the CSRF header and keeps the login alive", async () => {
      t = await buildAuthTestApp();
      const { jar } = await signUp(t.app);
      const response = await t.app.inject({
        method: "POST",
        url: "/auth/logout",
        headers: { origin: ORIGIN, cookie: jar.header },
      });
      expect(response.statusCode).toBe(403);
      expect((await refresh(t.app, jar)).statusCode).toBe(200);
    });

    it("answers 403 with a wrong CSRF header", async () => {
      t = await buildAuthTestApp();
      const { jar } = await signUp(t.app);
      expect((await logOut(t.app, jar, { "x-csrf-token": "x".repeat(43) })).statusCode).toBe(403);
    });

    it.each([
      ["no Origin header", {}],
      ["a foreign origin", { origin: "https://evil.example.com" }],
    ])("answers 403 with %s and keeps the login alive", async (_label, headers) => {
      t = await buildAuthTestApp();
      const { jar } = await signUp(t.app);
      const response = await t.app.inject({
        method: "POST",
        url: "/auth/logout",
        headers: { cookie: jar.header, "x-csrf-token": jar.get("csrf_token") ?? "", ...headers },
      });
      expect(response.statusCode).toBe(403);
      expect((await refresh(t.app, jar)).statusCode).toBe(200);
    });
  });

  it("limits logouts per address", async () => {
    t = await buildAuthTestApp({ limits: { logout: { max: 1, windowSeconds: 60 } } });
    const { jar } = await signUp(t.app);
    expect((await logOut(t.app, jar)).statusCode).toBe(204);
    expect((await logOut(t.app, jar)).statusCode).toBe(429);
  });
});
