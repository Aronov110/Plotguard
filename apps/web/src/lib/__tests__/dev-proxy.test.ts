import { describe, expect, it } from "vitest";
import { createApiProxy } from "../dev-proxy.ts";

describe("createApiProxy", () => {
  it("forwards only /auth", () => {
    expect(Object.keys(createApiProxy(undefined))).toEqual(["/auth"]);
  });

  it("defaults to the local API", () => {
    expect(createApiProxy(undefined)["/auth"]?.target).toBe("http://127.0.0.1:3000");
  });

  it("uses the address it is given", () => {
    expect(createApiProxy("http://localhost:4000")["/auth"]?.target).toBe("http://localhost:4000");
  });

  it("accepts https and a trailing slash", () => {
    expect(createApiProxy("https://api.example.test/")["/auth"]?.target).toBe(
      "https://api.example.test",
    );
  });

  it("keeps the browser's Origin header, which the API checks against its allowlist", () => {
    const rule = createApiProxy(undefined)["/auth"];
    expect(rule?.changeOrigin).toBe(false);
  });

  it("does not proxy web sockets", () => {
    expect(createApiProxy(undefined)["/auth"]?.ws).toBe(false);
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
