import { describe, expect, it } from "vitest";
import { AUTH_PROXY_KEY, createApiProxy, PROJECTS_PROXY_KEY } from "../dev-proxy.ts";

describe("createApiProxy", () => {
  it("forwards /auth and /projects, and nothing else", () => {
    expect(Object.keys(createApiProxy(undefined)).sort()).toEqual(
      [AUTH_PROXY_KEY, PROJECTS_PROXY_KEY].sort(),
    );
  });

  it("sends both to the same API with the same settings", () => {
    const proxy = createApiProxy("http://localhost:4000");
    expect(proxy[PROJECTS_PROXY_KEY]).toEqual(proxy[AUTH_PROXY_KEY]);
    expect(proxy[PROJECTS_PROXY_KEY]?.target).toBe("http://localhost:4000");
    expect(proxy[PROJECTS_PROXY_KEY]?.changeOrigin).toBe(false);
    expect(proxy[PROJECTS_PROXY_KEY]?.ws).toBe(false);
  });

  it("defaults to the local API", () => {
    expect(createApiProxy(undefined)[AUTH_PROXY_KEY]?.target).toBe("http://127.0.0.1:3000");
  });

  it("uses the address it is given", () => {
    expect(createApiProxy("http://localhost:4000")[AUTH_PROXY_KEY]?.target).toBe(
      "http://localhost:4000",
    );
  });

  it("accepts https and a trailing slash", () => {
    expect(createApiProxy("https://api.example.test/")[AUTH_PROXY_KEY]?.target).toBe(
      "https://api.example.test",
    );
  });

  it("keeps the browser's Origin header, which the API checks against its allowlist", () => {
    expect(createApiProxy(undefined)[AUTH_PROXY_KEY]?.changeOrigin).toBe(false);
  });

  it("does not proxy web sockets", () => {
    expect(createApiProxy(undefined)[AUTH_PROXY_KEY]?.ws).toBe(false);
  });

  it.each([
    ["not a URL", "not a url"],
    ["an empty string", ""],
    ["a non-http scheme", "ftp://127.0.0.1:3000"],
    ["a path, which would change the paths the cookies see", "http://127.0.0.1:3000/api"],
    ["a query string", "http://127.0.0.1:3000?x=1"],
    ["credentials", "http://user:pass@127.0.0.1:3000"],
  ])("rejects %s", (_name, value) => {
    expect(() => createApiProxy(value)).toThrow(/API_URL/);
  });
});

describe("the /auth rule", () => {
  // Vite treats a key that starts with ^ as a regular expression and tests it against the
  // request path including its query string. A plain "/auth" key would match by prefix and
  // forward page addresses such as /authors to the API.
  const rule = new RegExp(AUTH_PROXY_KEY);

  it("is written as a regular expression", () => {
    expect(AUTH_PROXY_KEY.startsWith("^")).toBe(true);
  });

  it.each(["/auth", "/auth/", "/auth/login", "/auth/refresh", "/auth/me", "/auth?x=1"])(
    "forwards %s",
    (path) => {
      expect(rule.test(path)).toBe(true);
    },
  );

  it.each([
    "/authors",
    "/auth-callback",
    "/authentication",
    "/auth_x",
    "/login",
    "/register",
    "/app",
    "/",
    "/x/auth",
    "/Auth",
  ])("does not forward %s, which stays a page address", (path) => {
    expect(rule.test(path)).toBe(false);
  });
});

describe("the /projects rule", () => {
  const rule = new RegExp(PROJECTS_PROXY_KEY);

  it("is written as a regular expression", () => {
    expect(PROJECTS_PROXY_KEY.startsWith("^")).toBe(true);
  });

  it.each([
    "/projects",
    "/projects/",
    "/projects/019e5a3c-1b2d-7c4e-8f10-a1b2c3d4e5f6",
    "/projects?limit=5",
    "/projects?limit=5&cursor=abc",
    "/projects/x?y=1",
  ])("forwards %s", (path) => {
    expect(rule.test(path)).toBe(true);
  });

  it.each([
    "/projectsearch",
    "/projects-old",
    "/projects_x",
    "/Projects",
    "/app/projects",
    "/app",
    "/x/projects",
    "/",
    "/auth",
  ])("does not forward %s, which stays a page address", (path) => {
    expect(rule.test(path)).toBe(false);
  });

  it("does not make the auth rule forward projects, or the other way round", () => {
    expect(new RegExp(AUTH_PROXY_KEY).test("/projects")).toBe(false);
    expect(rule.test("/auth")).toBe(false);
  });
});
