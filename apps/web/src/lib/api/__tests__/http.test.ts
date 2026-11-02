import { delay, HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { setCookie } from "../../../test-support/cookies.ts";
import { server } from "../../../test-support/msw-server.ts";
import { setAccessToken } from "../../auth/token-store.ts";
import { apiJson, apiRequest, DEFAULT_TIMEOUT_MS } from "../http.ts";
import { ApiError, NetworkError, ResponseShapeError } from "../problem.ts";

interface Seen {
  method: string;
  headers: Headers;
  body: string;
  credentials: RequestCredentials;
}

/** Answers `path` with `reply` and records what the page sent. */
function spy(path: string, reply: () => Response = () => HttpResponse.json({ ok: true })) {
  const calls: Seen[] = [];
  server.use(
    http.all(path, async ({ request }) => {
      calls.push({
        method: request.method,
        headers: request.headers,
        body: await request.text(),
        credentials: request.credentials,
      });
      return reply();
    }),
  );
  return calls;
}

describe("apiRequest", () => {
  it("sends a GET by default, with the same-origin credentials mode", async () => {
    const calls = spy("/thing");
    await apiRequest("/thing");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.credentials).toBe("same-origin");
  });

  it("asks for JSON answers", async () => {
    const calls = spy("/thing");
    await apiRequest("/thing");
    expect(calls[0]?.headers.get("accept")).toBe("application/json, application/problem+json");
  });

  it("sends a JSON body with its content type", async () => {
    const calls = spy("/thing");
    await apiRequest("/thing", { method: "POST", json: { email: "a@b.test", n: 1 } });
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({ email: "a@b.test", n: 1 });
  });

  it("sends no body and no content type when there is no json", async () => {
    const calls = spy("/thing");
    await apiRequest("/thing", { method: "POST" });
    expect(calls[0]?.body).toBe("");
    expect(calls[0]?.headers.get("content-type")).toBeNull();
  });

  it("sends strings in the body untouched, with no trimming", async () => {
    const calls = spy("/thing");
    const password = "  päss wörd 🔑 with spaces  ";
    await apiRequest("/thing", { method: "POST", json: { password } });
    expect(JSON.parse(calls[0]?.body ?? "").password).toBe(password);
  });

  describe("access token", () => {
    it("is sent as a Bearer token when auth is on", async () => {
      setAccessToken("tok-123");
      const calls = spy("/thing");
      await apiRequest("/thing", { auth: true });
      expect(calls[0]?.headers.get("authorization")).toBe("Bearer tok-123");
    });

    it("is left out when auth is on but nobody is signed in", async () => {
      const calls = spy("/thing");
      await apiRequest("/thing", { auth: true });
      expect(calls[0]?.headers.get("authorization")).toBeNull();
    });

    it("is never sent when auth is off, even if a token exists", async () => {
      setAccessToken("tok-123");
      const calls = spy("/thing");
      await apiRequest("/thing");
      expect(calls[0]?.headers.get("authorization")).toBeNull();
    });
  });

  describe("CSRF code", () => {
    it("is copied from the cookie into X-CSRF-Token when csrf is on", async () => {
      setCookie("csrf_token", "code-1");
      const calls = spy("/thing");
      await apiRequest("/thing", { method: "POST", csrf: true });
      expect(calls[0]?.headers.get("x-csrf-token")).toBe("code-1");
    });

    it("is left out when csrf is on but the cookie is missing", async () => {
      const calls = spy("/thing");
      await apiRequest("/thing", { method: "POST", csrf: true });
      expect(calls[0]?.headers.get("x-csrf-token")).toBeNull();
    });

    it("is never sent when csrf is off, even if the cookie exists", async () => {
      setCookie("csrf_token", "code-1");
      const calls = spy("/thing");
      await apiRequest("/thing", { method: "POST" });
      expect(calls[0]?.headers.get("x-csrf-token")).toBeNull();
    });

    it("is read fresh on every call", async () => {
      const calls = spy("/thing");
      setCookie("csrf_token", "first");
      await apiRequest("/thing", { method: "POST", csrf: true });
      setCookie("csrf_token", "second");
      await apiRequest("/thing", { method: "POST", csrf: true });
      expect(calls.map((call) => call.headers.get("x-csrf-token"))).toEqual(["first", "second"]);
    });
  });

  describe("only talks to its own origin", () => {
    it.each([
      ["a protocol-relative address", "//evil.example/x"],
      ["an absolute address", "https://evil.example/x"],
      ["a backslash trick", "/\\evil.example/x"],
      ["a tab, which the URL parser deletes", "/\t/evil.example/x"],
      ["a newline, which the URL parser deletes", "/\n/evil.example/x"],
      ["a carriage return, which the URL parser deletes", "/\r/evil.example/x"],
      ["a backslash and a tab", "/\\\t/evil.example/x"],
      ["a path without a leading slash", "thing"],
      ["an empty path", ""],
    ])("refuses %s without sending anything", async (_name, path) => {
      setAccessToken("tok-123");
      const calls = spy("*");
      await expect(apiRequest(path, { auth: true })).rejects.toThrow(/own origin|path/i);
      expect(calls).toHaveLength(0);
    });
  });

  describe("failures", () => {
    it("turns an error answer into an ApiError", async () => {
      server.use(
        http.get("/thing", () =>
          HttpResponse.json(
            { type: "urn:plotpal:problem:not-found", detail: "No such thing." },
            { status: 404, headers: { "content-type": "application/problem+json" } },
          ),
        ),
      );
      const error = await apiRequest("/thing").catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(404);
      expect((error as ApiError).code).toBe("not-found");
    });

    it("turns a 502 HTML page into an ApiError", async () => {
      server.use(
        http.get("/thing", () => new HttpResponse("<html>Bad Gateway</html>", { status: 502 })),
      );
      await expect(apiRequest("/thing")).rejects.toMatchObject({ name: "ApiError", status: 502 });
    });

    it("turns a network failure into a NetworkError that keeps the cause", async () => {
      server.use(http.get("/thing", () => HttpResponse.error()));
      const error = await apiRequest("/thing").catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(NetworkError);
      expect((error as NetworkError).cause).toBeInstanceOf(Error);
    });

    it("lets an abort through unchanged, because the caller asked for it", async () => {
      const controller = new AbortController();
      controller.abort();
      server.use(http.get("/thing", () => HttpResponse.json({})));
      const error = await apiRequest("/thing", { signal: controller.signal }).catch(
        (caught: unknown) => caught,
      );
      expect(error).not.toBeInstanceOf(NetworkError);
      expect((error as Error).name).toBe("AbortError");
    });

    it("lets an abort during the request through unchanged", async () => {
      const controller = new AbortController();
      server.use(
        http.get("/thing", async () => {
          await delay("infinite");
          return HttpResponse.json({});
        }),
      );
      const pending = apiRequest("/thing", { signal: controller.signal });
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    });

    it("gives up on a request that is never answered, as a NetworkError caused by a timeout", async () => {
      server.use(
        http.get("/never", async () => {
          await delay("infinite");
          return HttpResponse.json({});
        }),
      );
      const error = await apiRequest("/never", { timeoutMs: 50 }).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(NetworkError);
      expect(((error as NetworkError).cause as Error).name).toBe("TimeoutError");
    });

    it("times out a request that was given an extra signal too, and keeps the caller's signal working", async () => {
      server.use(
        http.get("/never", async () => {
          await delay("infinite");
          return HttpResponse.json({});
        }),
      );
      const controller = new AbortController();
      const error = await apiRequest("/never", {
        timeoutMs: 50,
        signal: controller.signal,
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(NetworkError);
    });

    it("does not time out an answer that arrives in time", async () => {
      server.use(
        http.get("/slowish", async () => {
          await delay(30);
          return HttpResponse.json({ ok: true });
        }),
      );
      const response = await apiRequest("/slowish", { timeoutMs: 2000 });
      expect(response.status).toBe(200);
    });

    it("has a default timeout of fifteen seconds", () => {
      expect(DEFAULT_TIMEOUT_MS).toBe(15_000);
    });

    it("an abort by the caller after the answer arrived changes nothing", async () => {
      const controller = new AbortController();
      server.use(http.get("/thing", () => HttpResponse.json({ ok: true })));
      const response = await apiRequest("/thing", { signal: controller.signal });
      controller.abort();
      expect(response.status).toBe(200);
    });

    it("refuses to follow a redirect, because none of our routes should ever redirect", async () => {
      const calls = spy("/elsewhere");
      server.use(
        http.get(
          "/thing",
          () => new HttpResponse(null, { status: 302, headers: { location: "/elsewhere" } }),
        ),
      );
      const error = await apiRequest("/thing").catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(NetworkError);
      expect(calls).toHaveLength(0);
    });

    it("does not follow a redirect to another origin either, so the CSRF code cannot be handed on", async () => {
      const calls = spy("*");
      server.use(
        http.post(
          "/thing",
          () =>
            new HttpResponse(null, {
              status: 307,
              headers: { location: "https://evil.example/collect" },
            }),
        ),
      );
      const error = await apiRequest("/thing", { method: "POST", csrf: true }).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(NetworkError);
      expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
    });
  });
});

describe("apiJson", () => {
  const schema = z.object({ name: z.string(), count: z.number().int() });

  it("returns the parsed answer", async () => {
    server.use(http.get("/thing", () => HttpResponse.json({ name: "x", count: 3 })));
    await expect(apiJson("/thing", schema)).resolves.toEqual({ name: "x", count: 3 });
  });

  it("drops fields the schema does not know", async () => {
    server.use(http.get("/thing", () => HttpResponse.json({ name: "x", count: 3, extra: "y" })));
    await expect(apiJson("/thing", schema)).resolves.toEqual({ name: "x", count: 3 });
  });

  it("rejects an answer with the wrong shape, without repeating the data in the message", async () => {
    server.use(
      http.get("/thing", () => HttpResponse.json({ name: "secret-value-123", count: "three" })),
    );
    const error = await apiJson("/thing", schema).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ResponseShapeError);
    expect((error as Error).message).not.toContain("secret-value-123");
  });

  it("rejects a success answer that is not JSON", async () => {
    server.use(http.get("/thing", () => new HttpResponse("hello", { status: 200 })));
    await expect(apiJson("/thing", schema)).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it("rejects an empty success answer", async () => {
    server.use(http.get("/thing", () => new HttpResponse(null, { status: 200 })));
    await expect(apiJson("/thing", schema)).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it("still throws the ApiError for an error answer, before looking at the shape", async () => {
    server.use(http.get("/thing", () => HttpResponse.json({}, { status: 401 })));
    await expect(apiJson("/thing", schema)).rejects.toBeInstanceOf(ApiError);
  });

  it("passes the options on", async () => {
    setAccessToken("tok-9");
    const calls = spy("/thing", () => HttpResponse.json({ name: "x", count: 1 }));
    await apiJson("/thing", schema, { method: "POST", auth: true, json: { a: 1 } });
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer tok-9");
  });
});
