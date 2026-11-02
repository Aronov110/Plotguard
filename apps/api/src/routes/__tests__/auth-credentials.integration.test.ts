import { afterEach, describe, expect, it } from "vitest";
import { users } from "../../db/schema/users.ts";
import {
  type AuthTestApp,
  buildAuthTestApp,
  findCookie,
  logIn,
  ORIGIN,
  PASSWORD,
  refresh,
  setCookies,
  signUp,
} from "../../test-support/auth-app.ts";

const PROBLEM = /^application\/problem\+json/;
const DAY_SECONDS = 24 * 60 * 60;

let t: AuthTestApp;
afterEach(async () => {
  await t.close();
});

const post = (
  url: string,
  payload: unknown,
  headers: Record<string, string> = { origin: ORIGIN },
) => t.app.inject({ method: "POST", url, headers, payload: payload as object });

describe("POST /auth/register", () => {
  it("creates the account and answers 201 with the user and an access token", async () => {
    t = await buildAuthTestApp();
    const { response, body } = await signUp(t.app);

    expect(response.statusCode).toBe(201);
    expect(response.headers["content-type"]).toMatch(/^application\/json/);
    expect(body).toEqual({
      user: { id: expect.any(String), email: "mara@example.com", displayName: "Mara" },
      accessToken: expect.any(String),
      expiresIn: 900,
    });
  });

  it("never puts the refresh token, the CSRF code or the password hash in the body", async () => {
    t = await buildAuthTestApp();
    const { response, jar } = await signUp(t.app);
    const text = response.body;
    expect(text).not.toContain(jar.get("refresh_token") ?? "never");
    expect(text).not.toContain(jar.get("csrf_token") ?? "never");
    expect(text).not.toMatch(/argon2|password/i);
  });

  describe("cookies", () => {
    it("sets a locked refresh cookie", async () => {
      t = await buildAuthTestApp();
      const { response } = await signUp(t.app);
      const cookie = findCookie(response, "refresh_token");

      expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(cookie?.attributes).toMatchObject({
        httponly: true,
        samesite: "Strict",
        path: "/auth",
      });
      expect(cookie?.attributes).not.toHaveProperty("domain");
      expect(cookie?.attributes).not.toHaveProperty("secure");
      expect(Math.abs(Number(cookie?.attributes["max-age"]) - 30 * DAY_SECONDS)).toBeLessThan(120);
    });

    it("sets a CSRF cookie that the page's script can read", async () => {
      t = await buildAuthTestApp();
      const { response } = await signUp(t.app);
      const cookie = findCookie(response, "csrf_token");

      expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(cookie?.attributes).toMatchObject({ samesite: "Strict", path: "/" });
      expect(cookie?.attributes).not.toHaveProperty("httponly");
      expect(cookie?.attributes).not.toHaveProperty("domain");
    });

    it("gives both cookies the same lifetime", async () => {
      t = await buildAuthTestApp();
      const { response } = await signUp(t.app);
      expect(findCookie(response, "csrf_token")?.attributes["max-age"]).toBe(
        findCookie(response, "refresh_token")?.attributes["max-age"],
      );
    });

    it("sets exactly two cookies", async () => {
      t = await buildAuthTestApp();
      const { response } = await signUp(t.app);
      expect(
        setCookies(response)
          .map((c) => c.name)
          .sort(),
      ).toEqual(["csrf_token", "refresh_token"]);
    });

    it("marks both cookies Secure in production", async () => {
      t = await buildAuthTestApp({
        env: { NODE_ENV: "production", CORS_ORIGINS: "https://app.example.com" },
      });
      const response = await t.app.inject({
        method: "POST",
        url: "/auth/register",
        headers: { origin: "https://app.example.com" },
        payload: { email: "mara@example.com", password: PASSWORD },
      });
      expect(response.statusCode).toBe(201);
      for (const name of ["refresh_token", "csrf_token"]) {
        expect(findCookie(response, name)?.attributes).toHaveProperty("secure", true);
      }
    });
  });

  describe("what is stored", () => {
    it("keeps an argon2id hash, a trimmed lowercase email and the refresh token only as a hash", async () => {
      t = await buildAuthTestApp();
      const { jar } = await signUp(t.app, { email: "  Mara.Writer@Example.COM " });
      const [user] = await t.handle.db.select().from(users);

      expect(user?.email).toBe("mara.writer@example.com");
      expect(user?.passwordHash.startsWith("$argon2id$")).toBe(true);
      expect(user?.passwordHash).not.toContain(PASSWORD);
      const sessions = await t.handle.pool.query("select token_hash from refresh_sessions");
      expect(sessions.rows).toHaveLength(1);
      expect(JSON.stringify(sessions.rows)).not.toContain(jar.get("refresh_token") ?? "never");
    });

    it("accepts a sign-up without a display name", async () => {
      t = await buildAuthTestApp();
      const { response, body } = await signUp(t.app, { displayName: null });
      expect(response.statusCode).toBe(201);
      expect(body.user.displayName).toBeNull();
    });

    it("accepts a sign-up that leaves the display name out completely", async () => {
      t = await buildAuthTestApp();
      const response = await post("/auth/register", { email: "a@example.com", password: PASSWORD });
      expect(response.statusCode).toBe(201);
    });
  });

  describe("an email that is already registered", () => {
    it.each(["mara@example.com", "MARA@EXAMPLE.COM", "  Mara@Example.com "])(
      "answers 409 for %j and sets no cookies",
      async (again) => {
        t = await buildAuthTestApp();
        await signUp(t.app);
        const { response } = await signUp(t.app, { email: again });

        expect(response.statusCode).toBe(409);
        expect(response.headers["content-type"]).toMatch(PROBLEM);
        expect(response.json()).toMatchObject({
          type: "urn:plotpal:problem:conflict",
          status: 409,
          detail: "That email is already registered.",
        });
        expect(setCookies(response)).toHaveLength(0);
        expect(await t.handle.db.select().from(users)).toHaveLength(1);
      },
    );

    it("lets one of several simultaneous sign-ups win and answers the rest with 409, never 500", async () => {
      t = await buildAuthTestApp();
      const responses = await Promise.all(
        Array.from({ length: 6 }, () =>
          post("/auth/register", { email: "race@example.com", password: PASSWORD }),
        ),
      );
      const codes = responses.map((r) => r.statusCode).sort();
      expect(codes).toEqual([201, 409, 409, 409, 409, 409]);
    });
  });

  describe("bad input", () => {
    it("lists every invalid field with its place", async () => {
      t = await buildAuthTestApp();
      const response = await post("/auth/register", {
        email: "not-an-email",
        password: "short",
        displayName: "a\tb",
      });
      expect(response.statusCode).toBe(400);
      expect(response.headers["content-type"]).toMatch(PROBLEM);
      const errors = response.json<{ errors: { pointer: string; message: string }[] }>().errors;
      expect(errors.map((e) => e.pointer).sort()).toEqual(["/displayName", "/email", "/password"]);
      expect(errors.find((e) => e.pointer === "/password")?.message).toBe(
        "Use at least 12 characters.",
      );
    });

    it.each([
      ["an empty object", {}],
      ["a missing password", { email: "a@example.com" }],
      ["a missing email", { password: PASSWORD }],
      ["a number as the email", { email: 5, password: PASSWORD }],
      ["null as the password", { email: "a@example.com", password: null }],
      ["an array as the body", [{ email: "a@example.com", password: PASSWORD }]],
      ["an unknown extra field", { email: "a@example.com", password: PASSWORD, admin: true }],
      ["a non-ASCII email", { email: "mára@example.com", password: PASSWORD }],
      [
        "an 81-character display name",
        { email: "a@example.com", password: PASSWORD, displayName: "a".repeat(81) },
      ],
    ])("answers 400 for %s and creates nothing", async (_label, payload) => {
      t = await buildAuthTestApp();
      const response = await post("/auth/register", payload);
      expect(response.statusCode).toBe(400);
      expect(response.headers["content-type"]).toMatch(PROBLEM);
      expect(await t.handle.db.select().from(users)).toHaveLength(0);
    });

    it("answers 400 for a body that is not JSON, without echoing it", async () => {
      t = await buildAuthTestApp();
      const response = await t.app.inject({
        method: "POST",
        url: "/auth/register",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        payload: '{"email": "SECRET-LEAK", ',
      });
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain("SECRET-LEAK");
    });

    it("answers 400 for an empty body", async () => {
      t = await buildAuthTestApp();
      const response = await t.app.inject({
        method: "POST",
        url: "/auth/register",
        headers: { origin: ORIGIN },
      });
      expect(response.statusCode).toBe(400);
    });

    it("never echoes the password or email back", async () => {
      t = await buildAuthTestApp();
      const response = await post("/auth/register", {
        email: "leak-me-email",
        password: "leak-me-pw",
      });
      expect(response.body).not.toContain("leak-me");
    });
  });

  describe("limits on the request itself", () => {
    it("answers 413 for a body over 4 KiB", async () => {
      t = await buildAuthTestApp();
      const response = await post("/auth/register", {
        email: "a@example.com",
        password: PASSWORD,
        displayName: "x".repeat(5000),
      });
      expect(response.statusCode).toBe(413);
      expect(response.headers["content-type"]).toMatch(PROBLEM);
    });

    it("accepts a body just under 4 KiB", async () => {
      t = await buildAuthTestApp();
      const response = await post("/auth/register", {
        email: "a@example.com",
        password: PASSWORD,
        displayName: "x".repeat(80),
      });
      expect(response.statusCode).toBe(201);
    });

    it("answers 415 for text/plain", async () => {
      t = await buildAuthTestApp();
      const response = await t.app.inject({
        method: "POST",
        url: "/auth/register",
        headers: { origin: ORIGIN, "content-type": "text/plain" },
        payload: "email=a@example.com",
      });
      expect(response.statusCode).toBe(415);
    });
  });

  describe("the Origin check", () => {
    it.each([
      ["no Origin header", undefined],
      ["a foreign origin", "https://evil.example.com"],
      ["a look-alike", "http://localhost:5173.evil.com"],
      ["another port", "http://localhost:9999"],
      ["another scheme", "https://localhost:5173"],
      ["the null origin", "null"],
      ["an empty origin", ""],
    ])("answers 403 with %s and creates nothing", async (_label, origin) => {
      t = await buildAuthTestApp();
      const headers: Record<string, string> = origin === undefined ? {} : { origin };
      const response = await post(
        "/auth/register",
        { email: "a@example.com", password: PASSWORD },
        headers,
      );
      expect(response.statusCode).toBe(403);
      expect(response.headers["content-type"]).toMatch(PROBLEM);
      expect(await t.handle.db.select().from(users)).toHaveLength(0);
    });

    it("accepts every origin on the list", async () => {
      t = await buildAuthTestApp();
      for (const [i, origin] of ["http://localhost:5173", "http://127.0.0.1:5173"].entries()) {
        const response = await post(
          "/auth/register",
          { email: `ok${i}@example.com`, password: PASSWORD },
          { origin },
        );
        expect(response.statusCode).toBe(201);
      }
    });
  });
});

describe("POST /auth/login", () => {
  it("signs in with the right password", async () => {
    t = await buildAuthTestApp();
    await signUp(t.app);
    const response = await logIn(t.app);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: { id: expect.any(String), email: "mara@example.com", displayName: "Mara" },
      accessToken: expect.any(String),
      expiresIn: 900,
    });
    expect(
      setCookies(response)
        .map((c) => c.name)
        .sort(),
    ).toEqual(["csrf_token", "refresh_token"]);
    expect(findCookie(response, "refresh_token")?.attributes).toMatchObject({
      httponly: true,
      samesite: "Strict",
      path: "/auth",
    });
  });

  it("ignores case and padding in the email", async () => {
    t = await buildAuthTestApp();
    await signUp(t.app);
    expect((await logIn(t.app, "  MARA@Example.COM ")).statusCode).toBe(200);
  });

  it("gives each login its own refresh token, and both keep working", async () => {
    t = await buildAuthTestApp();
    const first = await signUp(t.app);
    const second = await logIn(t.app);
    const secondJar = new (await import("../../test-support/auth-app.ts")).CookieJar();
    secondJar.update(second);

    expect(findCookie(second, "refresh_token")?.value).not.toBe(first.jar.get("refresh_token"));
    expect((await refresh(t.app, first.jar)).statusCode).toBe(200);
    expect((await refresh(t.app, secondJar)).statusCode).toBe(200);
  });

  describe("a failed login", () => {
    it("looks exactly the same for a wrong password and an unknown email", async () => {
      t = await buildAuthTestApp();
      await signUp(t.app);
      const wrong = await logIn(t.app, "mara@example.com", "a wrong password 123");
      const unknown = await logIn(t.app, "nobody@example.com", "a wrong password 123");

      expect(wrong.statusCode).toBe(401);
      expect(unknown.statusCode).toBe(401);
      expect(wrong.body).toBe(unknown.body);
      expect(wrong.headers["content-type"]).toMatch(PROBLEM);
      expect(wrong.headers["www-authenticate"]).toBe(unknown.headers["www-authenticate"]);
      expect(wrong.json().detail).toBe("Invalid email or password.");
    });

    it("sets no cookies and creates no session", async () => {
      t = await buildAuthTestApp();
      await signUp(t.app);
      const response = await logIn(t.app, "mara@example.com", "a wrong password 123");
      expect(setCookies(response)).toHaveLength(0);
      const sessions = await t.handle.pool.query("select 1 from refresh_sessions");
      expect(sessions.rows).toHaveLength(1);
    });

    it("answers 401, not 400, for a password that breaks the sign-up rules", async () => {
      t = await buildAuthTestApp();
      await signUp(t.app);
      expect((await logIn(t.app, "mara@example.com", "a".repeat(129))).statusCode).toBe(401);
      expect((await logIn(t.app, "mara@example.com", "short")).statusCode).toBe(401);
    });

    it.each([
      ["no password", { email: "mara@example.com" }],
      ["no email", { password: PASSWORD }],
      ["an empty object", {}],
      ["a number as the password", { email: "mara@example.com", password: 12345678901234 }],
      ["an unknown field", { email: "mara@example.com", password: PASSWORD, remember: true }],
    ])("answers 400 for %s", async (_label, payload) => {
      t = await buildAuthTestApp();
      expect((await post("/auth/login", payload)).statusCode).toBe(400);
    });

    it("answers 413 for an oversized body", async () => {
      t = await buildAuthTestApp();
      const response = await post("/auth/login", {
        email: "a@example.com",
        password: "x".repeat(5000),
      });
      expect(response.statusCode).toBe(413);
    });
  });

  describe("the Origin check", () => {
    it.each([
      ["no Origin header", undefined],
      ["a foreign origin", "https://evil.example.com"],
    ])("answers 403 with %s and does not even check the password", async (_label, origin) => {
      t = await buildAuthTestApp();
      await signUp(t.app);
      const headers: Record<string, string> = origin === undefined ? {} : { origin };
      const response = await post(
        "/auth/login",
        { email: "mara@example.com", password: PASSWORD },
        headers,
      );
      expect(response.statusCode).toBe(403);
      expect(setCookies(response)).toHaveLength(0);
    });
  });

  describe("rate limits", () => {
    it("limits attempts per address, whether they succeed or fail", async () => {
      t = await buildAuthTestApp({ limits: { login: { max: 3, windowSeconds: 60 } } });
      await signUp(t.app);
      const statuses: number[] = [];
      for (const password of [PASSWORD, "wrong password 123", PASSWORD, PASSWORD]) {
        statuses.push((await logIn(t.app, "mara@example.com", password)).statusCode);
      }
      expect(statuses).toEqual([200, 401, 200, 429]);
    });

    it("answers with Problem Details and Retry-After", async () => {
      t = await buildAuthTestApp({ limits: { login: { max: 1, windowSeconds: 60 } } });
      await logIn(t.app);
      const limited = await logIn(t.app);
      expect(limited.statusCode).toBe(429);
      expect(limited.headers["content-type"]).toMatch(PROBLEM);
      expect(Number(limited.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    });

    it("counts each address on its own", async () => {
      t = await buildAuthTestApp({ limits: { login: { max: 1, windowSeconds: 60 } } });
      const attempt = (ip: string) =>
        t.app.inject({
          method: "POST",
          url: "/auth/login",
          remoteAddress: ip,
          headers: { origin: ORIGIN },
          payload: { email: "mara@example.com", password: PASSWORD },
        });
      expect((await attempt("10.1.0.1")).statusCode).toBe(401);
      expect((await attempt("10.1.0.2")).statusCode).toBe(401);
      expect((await attempt("10.1.0.1")).statusCode).toBe(429);
    });

    it("also limits attempts on one email address, from any address", async () => {
      t = await buildAuthTestApp({ limits: { loginPerEmail: { max: 3, windowSeconds: 60 } } });
      const attempt = (ip: string, email = "mara@example.com") =>
        t.app.inject({
          method: "POST",
          url: "/auth/login",
          remoteAddress: ip,
          headers: { origin: ORIGIN },
          payload: { email, password: "wrong password 123" },
        });
      const statuses: number[] = [];
      for (let i = 1; i <= 5; i++) statuses.push((await attempt(`10.2.0.${i}`)).statusCode);
      expect(statuses).toEqual([401, 401, 401, 429, 429]);
      // Someone else's email is not affected.
      expect((await attempt("10.2.0.9", "other@example.com")).statusCode).toBe(401);
    });

    it("counts spelling variants of one email together", async () => {
      t = await buildAuthTestApp({ limits: { loginPerEmail: { max: 2, windowSeconds: 60 } } });
      const attempt = (email: string, ip: string) =>
        t.app.inject({
          method: "POST",
          url: "/auth/login",
          remoteAddress: ip,
          headers: { origin: ORIGIN },
          payload: { email, password: "wrong password 123" },
        });
      expect((await attempt("mara@example.com", "10.3.0.1")).statusCode).toBe(401);
      expect((await attempt("MARA@Example.com", "10.3.0.2")).statusCode).toBe(401);
      expect((await attempt("  mara@example.com ", "10.3.0.3")).statusCode).toBe(429);
    });

    it("limits sign-ups per address", async () => {
      t = await buildAuthTestApp({ limits: { register: { max: 2, windowSeconds: 60 } } });
      const statuses: number[] = [];
      for (let i = 0; i < 3; i++) {
        statuses.push((await signUp(t.app, { email: `n${i}@example.com` })).response.statusCode);
      }
      expect(statuses).toEqual([201, 201, 429]);
    });
  });
});
