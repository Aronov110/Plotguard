import { describe, expect, it } from "vitest";
import { setCookie } from "../../../test-support/cookies.ts";
import { readCsrfToken } from "../csrf-cookie.ts";

describe("readCsrfToken", () => {
  it("returns undefined when there are no cookies", () => {
    expect(readCsrfToken("")).toBeUndefined();
  });

  it("reads the development cookie", () => {
    expect(readCsrfToken("csrf_token=abc123")).toBe("abc123");
  });

  it("reads the production cookie", () => {
    expect(readCsrfToken("__Host-csrf_token=prod456")).toBe("prod456");
  });

  it("prefers the production cookie when both exist", () => {
    expect(readCsrfToken("csrf_token=dev; __Host-csrf_token=prod")).toBe("prod");
  });

  it("finds the cookie among others and ignores spaces around it", () => {
    expect(readCsrfToken("theme=dark;  csrf_token=abc ; other=1")).toBe("abc");
  });

  it("ignores cookies whose names only look similar", () => {
    expect(readCsrfToken("xcsrf_token=nope")).toBeUndefined();
    expect(readCsrfToken("csrf_token_old=nope")).toBeUndefined();
    expect(readCsrfToken("refresh_token=nope")).toBeUndefined();
    expect(readCsrfToken("_Host-csrf_token=nope")).toBeUndefined();
  });

  it("ignores a cookie with an empty value", () => {
    expect(readCsrfToken("csrf_token=")).toBeUndefined();
    expect(readCsrfToken("csrf_token=; __Host-csrf_token=")).toBeUndefined();
  });

  it("falls back to the development cookie when the production one is empty", () => {
    expect(readCsrfToken("__Host-csrf_token=; csrf_token=dev")).toBe("dev");
  });

  it("keeps equals signs inside the value", () => {
    expect(readCsrfToken("csrf_token=YWJj.ZGVm==")).toBe("YWJj.ZGVm==");
  });

  it("decodes percent-encoded values", () => {
    expect(readCsrfToken("csrf_token=a%2Bb%2Fc")).toBe("a+b/c");
  });

  it("returns undefined for a value with broken percent-encoding instead of throwing", () => {
    expect(readCsrfToken("csrf_token=%E0%A4%A")).toBeUndefined();
  });

  it("reads the page's own cookies by default", () => {
    setCookie("csrf_token", "from-the-page");
    expect(readCsrfToken()).toBe("from-the-page");
  });
});
