import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { setCookie } from "../../../test-support/cookies.ts";
import { server } from "../../../test-support/msw-server.ts";
import { setAccessToken } from "../../auth/token-store.ts";
import { authApi } from "../auth-api.ts";
import { ApiError, ResponseShapeError } from "../problem.ts";

const USER = {
  id: "0190a000-0000-7000-8000-000000000001",
  email: "ada@example.com",
  displayName: null,
};
const SESSION = { user: USER, accessToken: "access-1", expiresIn: 900 };

interface Seen {
  headers: Headers;
  body: string;
}

function answer(method: "post" | "get", path: string, body: unknown, status = 200) {
  const calls: Seen[] = [];
  server.use(
    http[method](path, async ({ request }) => {
      calls.push({ headers: request.headers, body: await request.text() });
      return body === undefined
        ? new HttpResponse(null, { status })
        : HttpResponse.json(body, { status });
    }),
  );
  return calls;
}

describe("authApi.register", () => {
  it("posts the details and returns the session", async () => {
    const calls = answer("post", "/auth/register", SESSION, 201);
    const session = await authApi.register({
      email: "ada@example.com",
      password: "correct horse battery",
      displayName: "Ada",
    });
    expect(session).toEqual(SESSION);
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({
      email: "ada@example.com",
      password: "correct horse battery",
      displayName: "Ada",
    });
    expect(calls[0]?.headers.get("content-type")).toBe("application/json");
  });

  it("leaves displayName out when it is not given", async () => {
    const calls = answer("post", "/auth/register", SESSION, 201);
    await authApi.register({ email: "ada@example.com", password: "correct horse battery" });
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({
      email: "ada@example.com",
      password: "correct horse battery",
    });
  });

  it("does not send the CSRF header or a token", async () => {
    setCookie("csrf_token", "code");
    setAccessToken("old-token");
    const calls = answer("post", "/auth/register", SESSION, 201);
    await authApi.register({ email: "ada@example.com", password: "correct horse battery" });
    expect(calls[0]?.headers.get("x-csrf-token")).toBeNull();
    expect(calls[0]?.headers.get("authorization")).toBeNull();
  });

  it("reports a validation problem with its field issues", async () => {
    server.use(
      http.post("/auth/register", () =>
        HttpResponse.json(
          {
            type: "urn:plotpal:problem:validation-error",
            errors: [{ pointer: "/email", message: "Enter a valid email address." }],
          },
          { status: 400, headers: { "content-type": "application/problem+json" } },
        ),
      ),
    );
    const error = await authApi
      .register({ email: "nope", password: "correct horse battery" })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).issues).toEqual([
      { pointer: "/email", message: "Enter a valid email address." },
    ]);
  });

  it("reports a duplicate email as a 409", async () => {
    answer("post", "/auth/register", { type: "urn:plotpal:problem:conflict" }, 409);
    await expect(
      authApi.register({ email: "ada@example.com", password: "correct horse battery" }),
    ).rejects.toMatchObject({ status: 409, code: "conflict" });
  });
});

describe("authApi.login", () => {
  it("posts the email and password and returns the session", async () => {
    const calls = answer("post", "/auth/login", SESSION);
    const session = await authApi.login({
      email: "ada@example.com",
      password: "correct horse battery",
    });
    expect(session).toEqual(SESSION);
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({
      email: "ada@example.com",
      password: "correct horse battery",
    });
  });

  it("does not send the CSRF header or a token", async () => {
    setCookie("csrf_token", "code");
    setAccessToken("old-token");
    const calls = answer("post", "/auth/login", SESSION);
    await authApi.login({ email: "ada@example.com", password: "x" });
    expect(calls[0]?.headers.get("x-csrf-token")).toBeNull();
    expect(calls[0]?.headers.get("authorization")).toBeNull();
  });

  it("reports wrong credentials as a 401", async () => {
    answer("post", "/auth/login", { type: "urn:plotpal:problem:unauthorized" }, 401);
    await expect(authApi.login({ email: "a@b.test", password: "wrong" })).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
    });
  });

  it("carries Retry-After from a 429", async () => {
    server.use(
      http.post("/auth/login", () =>
        HttpResponse.json(
          { type: "urn:plotpal:problem:rate-limited" },
          { status: 429, headers: { "retry-after": "42" } },
        ),
      ),
    );
    await expect(authApi.login({ email: "a@b.test", password: "x" })).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 42,
    });
  });

  it("accepts a user with a display name", async () => {
    answer("post", "/auth/login", { ...SESSION, user: { ...USER, displayName: "Ada" } });
    const session = await authApi.login({ email: "a@b.test", password: "x" });
    expect(session.user.displayName).toBe("Ada");
  });

  it.each([
    ["no access token", { user: USER, expiresIn: 900 }],
    ["no user", { accessToken: "a", expiresIn: 900 }],
    ["no lifetime", { user: USER, accessToken: "a" }],
    ["a lifetime of zero", { ...SESSION, expiresIn: 0 }],
    ["a negative lifetime", { ...SESSION, expiresIn: -5 }],
    ["a fractional lifetime", { ...SESSION, expiresIn: 1.5 }],
    ["an empty access token", { ...SESSION, accessToken: "" }],
    ["a user without an id", { ...SESSION, user: { email: "a@b.test", displayName: null } }],
  ])("rejects an answer with %s", async (_name, body) => {
    answer("post", "/auth/login", body);
    await expect(authApi.login({ email: "a@b.test", password: "x" })).rejects.toBeInstanceOf(
      ResponseShapeError,
    );
  });
});

describe("authApi.refresh", () => {
  it("posts with no body and no content type, with the CSRF header and no token", async () => {
    setCookie("csrf_token", "code-7");
    setAccessToken("old-token");
    const calls = answer("post", "/auth/refresh", SESSION);
    const session = await authApi.refresh();
    expect(session).toEqual(SESSION);
    expect(calls[0]?.body).toBe("");
    expect(calls[0]?.headers.get("content-type")).toBeNull();
    expect(calls[0]?.headers.get("x-csrf-token")).toBe("code-7");
    expect(calls[0]?.headers.get("authorization")).toBeNull();
  });

  it("reports an expired session as a 401", async () => {
    answer("post", "/auth/refresh", { type: "urn:plotpal:problem:unauthorized" }, 401);
    await expect(authApi.refresh()).rejects.toMatchObject({ status: 401 });
  });

  it("rejects an answer with the wrong shape", async () => {
    answer("post", "/auth/refresh", { hello: "world" });
    await expect(authApi.refresh()).rejects.toBeInstanceOf(ResponseShapeError);
  });
});

describe("authApi.logout", () => {
  it("posts with no body and no content type, with the CSRF header", async () => {
    setCookie("csrf_token", "code-8");
    const calls = answer("post", "/auth/logout", undefined, 204);
    await expect(authApi.logout()).resolves.toBeUndefined();
    expect(calls[0]?.body).toBe("");
    expect(calls[0]?.headers.get("content-type")).toBeNull();
    expect(calls[0]?.headers.get("x-csrf-token")).toBe("code-8");
  });

  it("reports a refused logout as an ApiError", async () => {
    answer("post", "/auth/logout", { type: "urn:plotpal:problem:forbidden" }, 403);
    await expect(authApi.logout()).rejects.toMatchObject({ status: 403 });
  });
});

describe("authApi.me", () => {
  it("gets the signed-in user with the Bearer token", async () => {
    setAccessToken("access-5");
    const calls = answer("get", "/auth/me", { user: USER });
    await expect(authApi.me()).resolves.toEqual(USER);
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer access-5");
  });

  it("reports a missing or expired token as a 401", async () => {
    answer("get", "/auth/me", { type: "urn:plotpal:problem:unauthorized" }, 401);
    await expect(authApi.me()).rejects.toMatchObject({ status: 401 });
  });

  it("rejects an answer without a user", async () => {
    answer("get", "/auth/me", {});
    await expect(authApi.me()).rejects.toBeInstanceOf(ResponseShapeError);
  });
});
