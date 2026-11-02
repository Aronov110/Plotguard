import { SignJWT } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { users } from "../../db/schema/users.ts";
import { type AuthTestApp, buildAuthTestApp, logOut, signUp } from "../../test-support/auth-app.ts";
import { testEnv } from "../../test-support/test-app.ts";

const PROBLEM = /^application\/problem\+json/;
const SECRET = testEnv().JWT_ACCESS_SECRET;

let t: AuthTestApp;
afterEach(async () => {
  await t.close();
});

const me = (authorization?: string) =>
  t.app.inject({
    method: "GET",
    url: "/auth/me",
    headers: authorization === undefined ? {} : { authorization },
  });

/** A correctly signed access token for any user id, with a lifetime the test chooses. */
async function tokenFor(userId: string, secret = SECRET, secondsFromNow = 600) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
    .setSubject(userId)
    .setIssuer("plotpal-api")
    .setAudience("plotpal-web")
    .setIssuedAt(now - (secondsFromNow < 0 ? 3600 : 0))
    .setExpirationTime(now + secondsFromNow)
    .sign(new TextEncoder().encode(secret));
}

describe("GET /auth/me", () => {
  it("returns the signed-in user", async () => {
    t = await buildAuthTestApp();
    const { body } = await signUp(t.app);
    const response = await me(`Bearer ${body.accessToken}`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: { id: body.user.id, email: "mara@example.com", displayName: "Mara" },
    });
  });

  it("never contains the password hash", async () => {
    t = await buildAuthTestApp();
    const { body } = await signUp(t.app);
    const response = await me(`Bearer ${body.accessToken}`);
    expect(response.body).not.toMatch(/argon2|password|hash/i);
  });

  it("does not need an Origin header: it is not changing anything", async () => {
    t = await buildAuthTestApp();
    const { body } = await signUp(t.app);
    expect((await me(`Bearer ${body.accessToken}`)).statusCode).toBe(200);
  });

  it("accepts the scheme in any letter case, as the HTTP rules say", async () => {
    t = await buildAuthTestApp();
    const { body } = await signUp(t.app);
    expect((await me(`bearer ${body.accessToken}`)).statusCode).toBe(200);
    expect((await me(`BEARER ${body.accessToken}`)).statusCode).toBe(200);
  });

  describe("without a good pass", () => {
    it("answers 401 with a WWW-Authenticate header when there is no header at all", async () => {
      t = await buildAuthTestApp();
      const response = await me();
      expect(response.statusCode).toBe(401);
      expect(response.headers["content-type"]).toMatch(PROBLEM);
      expect(response.headers["www-authenticate"]).toBe("Bearer");
    });

    it.each([
      ["only the scheme", "Bearer"],
      ["the scheme and a space", "Bearer "],
      ["the wrong scheme", "Basic dXNlcjpwYXNz"],
      ["a token without a scheme", "abc.def.ghi"],
      ["garbage", "Bearer not-a-token"],
      ["an empty value", ""],
      ["three parts of nonsense", "Bearer aaa.bbb.ccc"],
      ["two tokens", "Bearer aaa.bbb.ccc ddd.eee.fff"],
    ])("answers 401 for %s", async (_label, header) => {
      t = await buildAuthTestApp();
      expect((await me(header)).statusCode).toBe(401);
    });

    it("answers 401 for two spaces after the scheme, or whitespace around the token", async () => {
      t = await buildAuthTestApp();
      const { body } = await signUp(t.app);
      expect((await me(`Bearer  ${body.accessToken}`)).statusCode).toBe(401);
      expect((await me(`Bearer ${body.accessToken} `)).statusCode).toBe(401);
      expect((await me(`Bearer ${body.accessToken}x`)).statusCode).toBe(401);
    });

    it("answers 401 for a very long header", async () => {
      t = await buildAuthTestApp();
      expect((await me(`Bearer ${"a".repeat(10_000)}`)).statusCode).toBe(401);
    });

    it("answers 401 for an expired token", async () => {
      t = await buildAuthTestApp();
      const { body } = await signUp(t.app);
      const expired = await tokenFor(body.user.id, SECRET, -600);
      expect((await me(`Bearer ${expired}`)).statusCode).toBe(401);
    });

    it("answers 401 for a token signed with another secret", async () => {
      t = await buildAuthTestApp();
      const { body } = await signUp(t.app);
      const forged = await tokenFor(
        body.user.id,
        "Zx9Wv8Ut7Sr6Qp5On4Ml3Kj2Ih1Gf0Ed9Cb8Ba7Zy6Xw5Vu4Ts3Rq",
      );
      expect((await me(`Bearer ${forged}`)).statusCode).toBe(401);
    });

    it("answers 401 for a good token of a user that was deleted", async () => {
      t = await buildAuthTestApp();
      const { body } = await signUp(t.app);
      await t.handle.db.delete(users);
      expect((await me(`Bearer ${body.accessToken}`)).statusCode).toBe(401);
    });

    it("gives the same answer whatever is wrong with the token", async () => {
      t = await buildAuthTestApp();
      const { body } = await signUp(t.app);
      const reasons = await Promise.all([
        me("Bearer garbage"),
        me(`Bearer ${await tokenFor(body.user.id, SECRET, -600)}`),
        me(),
      ]);
      expect(new Set(reasons.map((r) => r.json().detail)).size).toBe(1);
    });
  });

  it("keeps working until the token expires, even after logout (the price of tokens that need no lookup)", async () => {
    t = await buildAuthTestApp();
    const { body, jar } = await signUp(t.app);
    await logOut(t.app, jar);
    expect((await me(`Bearer ${body.accessToken}`)).statusCode).toBe(200);
  });

  it("is only a GET", async () => {
    t = await buildAuthTestApp();
    const { body } = await signUp(t.app);
    const response = await t.app.inject({
      method: "POST",
      url: "/auth/me",
      headers: { authorization: `Bearer ${body.accessToken}`, origin: "http://localhost:5173" },
    });
    expect(response.statusCode).toBe(404);
  });
});
