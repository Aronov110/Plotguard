import { afterEach, describe, expect, it } from "vitest";
import {
  type AuthTestApp,
  buildAuthTestApp,
  logIn,
  logOut,
  ORIGIN,
  PASSWORD,
  refresh,
  signUp,
} from "../../test-support/auth-app.ts";

let t: AuthTestApp;
afterEach(async () => {
  await t.close();
});

describe("headers on every /auth response", () => {
  it("forbids caching of success and failure alike", async () => {
    t = await buildAuthTestApp({ limits: { login: { max: 1, windowSeconds: 60 } } });
    const { response: created, body, jar } = await signUp(t.app);
    const responses = [
      created,
      await signUp(t.app, { email: "bad" }).then((r) => r.response),
      await signUp(t.app).then((r) => r.response),
      await logIn(t.app),
      await logIn(t.app),
      await refresh(t.app, jar),
      await t.app.inject({ method: "POST", url: "/auth/refresh", headers: {} }),
      await logOut(t.app, jar),
      await t.app.inject({ method: "GET", url: "/auth/me" }),
      await t.app.inject({
        method: "GET",
        url: "/auth/me",
        headers: { authorization: `Bearer ${body.accessToken}` },
      }),
    ];
    const statuses = responses.map((r) => r.statusCode);
    expect(new Set(statuses).size).toBeGreaterThanOrEqual(5);
    for (const response of responses) {
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers.pragma).toBe("no-cache");
    }
  });

  it("keeps the baseline security headers", async () => {
    t = await buildAuthTestApp();
    const { response } = await signUp(t.app);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(response.headers["strict-transport-security"]).toMatch(/max-age=\d+/);
  });
});

describe("CORS for the auth routes", () => {
  it("lets the web app send the CSRF header, with cookies", async () => {
    t = await buildAuthTestApp();
    const response = await t.app.inject({
      method: "OPTIONS",
      url: "/auth/refresh",
      headers: {
        origin: ORIGIN,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,x-csrf-token",
      },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(String(response.headers["access-control-allow-headers"]).toLowerCase()).toContain(
      "x-csrf-token",
    );
  });

  it("lets the page read the answer to a sign-up from an allowed origin", async () => {
    t = await buildAuthTestApp();
    const { response } = await signUp(t.app);
    expect(response.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("does not let a foreign origin read anything", async () => {
    t = await buildAuthTestApp();
    const response = await t.app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { origin: "https://evil.example.com" },
      payload: { email: "mara@example.com", password: PASSWORD },
    });
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("the API reference", () => {
  async function spec() {
    t = await buildAuthTestApp();
    const response = await t.app.inject({ method: "GET", url: "/docs/openapi.json" });
    return response.json<{
      paths: Record<string, Record<string, Record<string, unknown>>>;
      components: { securitySchemes?: Record<string, Record<string, unknown>> };
      tags?: { name: string }[];
    }>();
  }

  it("lists all five routes under the auth tag", async () => {
    const doc = await spec();
    const routes = [
      ["/auth/register", "post"],
      ["/auth/login", "post"],
      ["/auth/refresh", "post"],
      ["/auth/logout", "post"],
      ["/auth/me", "get"],
    ] as const;
    for (const [path, method] of routes) {
      expect(doc.paths[path]?.[method]?.tags).toEqual(["auth"]);
    }
  });

  it("describes the request bodies", async () => {
    const doc = await spec();
    const register = JSON.stringify(doc.paths["/auth/register"]?.post?.requestBody);
    expect(register).toContain('"email"');
    expect(register).toContain('"password"');
    expect(register).toContain('"displayName"');
  });

  it("describes the success responses", async () => {
    const doc = await spec();
    expect(Object.keys((doc.paths["/auth/register"]?.post?.responses ?? {}) as object)).toContain(
      "201",
    );
    expect(Object.keys((doc.paths["/auth/login"]?.post?.responses ?? {}) as object)).toContain(
      "200",
    );
    expect(Object.keys((doc.paths["/auth/logout"]?.post?.responses ?? {}) as object)).toContain(
      "204",
    );
  });

  it("declares the bearer scheme and marks only /auth/me as needing it", async () => {
    const doc = await spec();
    expect(doc.components.securitySchemes?.bearerAuth).toMatchObject({
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
    });
    expect(doc.paths["/auth/me"]?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths["/auth/login"]?.post?.security).toBeUndefined();
  });

  it("explains the cookies and the CSRF header for refresh and logout", async () => {
    const doc = await spec();
    for (const path of ["/auth/refresh", "/auth/logout"]) {
      const text = JSON.stringify(doc.paths[path]?.post);
      expect(text).toContain("refresh_token");
      expect(text).toContain("X-CSRF-Token");
    }
  });
});

describe("security log lines", () => {
  const denied = () => t.logs.entries.filter((e) => e.event === "auth.denied");

  it("record a refused sign-in, a forged request and a rate limit at warn level", async () => {
    t = await buildAuthTestApp({ limits: { login: { max: 1, windowSeconds: 60 } } });
    await signUp(t.app);
    await logIn(t.app, "mara@example.com", "wrong password 123");
    await t.app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: { origin: "https://evil.example.com" },
    });
    await logIn(t.app);

    const entries = denied();
    expect(entries.map((e) => e.status).sort()).toEqual([401, 403, 429]);
    for (const entry of entries) {
      expect(entry.level).toBe(40);
      expect(entry).toMatchObject({ code: expect.any(String), route: expect.any(String) });
    }
    expect(entries.find((e) => e.status === 401)?.route).toBe("/auth/login");
  });

  it("are not written for ordinary client mistakes", async () => {
    t = await buildAuthTestApp();
    await signUp(t.app);
    await signUp(t.app);
    await signUp(t.app, { email: "bad" });
    await t.app.inject({ method: "GET", url: "/no-such-route" });
    expect(denied()).toEqual([]);
  });

  it("never contain credentials, tokens or email addresses", async () => {
    t = await buildAuthTestApp({ limits: { login: { max: 2, windowSeconds: 60 } } });
    const email = "sentinel-person-7f3a@example.com";
    const password = "sentinel-password-9c2e-ZZ";
    const { body, jar } = await signUp(t.app, { email, password });
    await signUp(t.app, { email, password });
    await logIn(t.app, email, `${password}-wrong`);
    await logIn(t.app, "other-sentinel-4d1b@example.com", password);
    await logIn(t.app, email, password);
    const refreshed = await refresh(t.app, jar);
    jar.update(refreshed);
    await t.app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    await t.app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: "Bearer forged.token.value" },
    });
    await logOut(t.app, jar);

    const text = t.logs.text;
    expect(text.length).toBeGreaterThan(100);
    for (const secret of [
      email,
      "sentinel-person-7f3a",
      "other-sentinel-4d1b",
      password,
      body.accessToken,
      refreshed.json().accessToken,
      jar.get("refresh_token") ?? "never-set",
      jar.get("csrf_token") ?? "never-set",
      "forged.token.value",
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});
