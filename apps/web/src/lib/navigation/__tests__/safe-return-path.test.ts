import { describe, expect, it } from "vitest";
import { safeReturnPath } from "../safe-return-path.ts";

describe("safeReturnPath", () => {
  describe("keeps addresses inside the app", () => {
    it.each([
      ["/app", "/app"],
      ["/app/", "/app/"],
      ["/app/projects/12", "/app/projects/12"],
      ["/app?tab=notes", "/app?tab=notes"],
      ["/app#section", "/app#section"],
      ["/app?a=1&b=2#end", "/app?a=1&b=2#end"],
      ["/", "/"],
      ["/authors", "/authors"],
      ["/auth-callback", "/auth-callback"],
      ["/a%20b", "/a%20b"],
    ])("%s -> %s", (value, expected) => {
      expect(safeReturnPath(value)).toBe(expected);
    });

    it("tidies a path with dot segments that stays inside the app", () => {
      expect(safeReturnPath("/app/./projects/../notes")).toBe("/app/notes");
    });
  });

  describe("refuses anything that could leave the site", () => {
    it.each([
      ["a protocol-relative address", "//evil.example"],
      ["a protocol-relative address with a path", "//evil.example/app"],
      ["an absolute https address", "https://evil.example/app"],
      ["an absolute http address", "http://evil.example"],
      ["a javascript: address", "javascript:alert(1)"],
      ["a data: address", "data:text/html,<script>alert(1)</script>"],
      ["a backslash after the slash", "/\\evil.example"],
      ["two backslashes", "\\\\evil.example"],
      ["a backslash and a slash", "/\\/evil.example"],
      ["a tab, which the URL parser deletes", "/\t/evil.example"],
      ["a newline, which the URL parser deletes", "/\n/evil.example"],
      ["a carriage return, which the URL parser deletes", "/\r/evil.example"],
      ["a backslash and a tab", "/\\\t/evil.example"],
      ["an address with a user name", "//user@evil.example"],
      ["a dot segment that leaves two slashes", "/.//evil.example"],
      ["a parent segment that leaves two slashes", "/a/..//evil.example"],
      ["two slashes left inside the app", "/app/..//x"],
      ["two slashes with a query", "/.//evil.example?x=1#y"],
    ])("%s", (_name, value) => {
      expect(safeReturnPath(value)).toBeUndefined();
    });
  });

  describe("refuses addresses that do not start with a slash", () => {
    it.each([
      ["an empty string", ""],
      ["a relative path", "app"],
      ["a leading space", " /app"],
      ["a leading tab", "\t/app"],
      ["a leading newline", "\n/app"],
      ["a query only", "?x=1"],
      ["a fragment only", "#x"],
    ])("%s", (_name, value) => {
      expect(safeReturnPath(value)).toBeUndefined();
    });
  });

  describe("refuses the API's own address space", () => {
    it.each([
      "/auth",
      "/auth/",
      "/auth/me",
      "/auth/login",
      "/auth?x=1",
      "/auth#x",
      "/%61uth/me",
      "/app/../auth/me",
      "/app/%2e%2e/auth",
      "/%2e%2e/auth",
      "/./auth",
    ])("%s", (value) => {
      expect(safeReturnPath(value)).toBeUndefined();
    });
  });

  describe("refuses values that are not text", () => {
    it.each([
      ["undefined", undefined],
      ["null", null],
      ["a number", 42],
      ["an object", { pathname: "/app" }],
      ["an array", ["/app"]],
      ["a boolean", true],
    ])("%s", (_name, value) => {
      expect(safeReturnPath(value)).toBeUndefined();
    });
  });

  it("refuses an absurdly long address", () => {
    expect(safeReturnPath(`/${"a".repeat(3000)}`)).toBeUndefined();
  });

  it("accepts a long but reasonable address", () => {
    const path = `/${"a".repeat(1000)}`;
    expect(safeReturnPath(path)).toBe(path);
  });

  it("returns only the path, query and fragment, never an origin", () => {
    const result = safeReturnPath("/app?x=1#y");
    expect(result?.startsWith("/")).toBe(true);
    expect(result).not.toContain("localhost");
  });
});
