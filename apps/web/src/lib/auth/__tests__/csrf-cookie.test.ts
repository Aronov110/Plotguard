import { describe, expect, it } from "vitest";
import { setCookie } from "../../../test-support/cookies.ts";
import { csrfCookieNames, readCsrfToken } from "../csrf-cookie.ts";

const DEV = csrfCookieNames(false);
const PROD = csrfCookieNames(true);

describe("csrfCookieNames", () => {
  it("is the plain name in development", () => {
    expect(DEV).toEqual(["csrf_token"]);
  });

  it("is only the __Host- name in production", () => {
    expect(PROD).toEqual(["__Host-csrf_token"]);
  });
});

describe("readCsrfToken", () => {
  it("returns undefined when there are no cookies", () => {
    expect(readCsrfToken("", DEV)).toBeUndefined();
    expect(readCsrfToken("", PROD)).toBeUndefined();
  });

  it("reads the development cookie in a development build", () => {
    expect(readCsrfToken("csrf_token=abc123", DEV)).toBe("abc123");
  });

  it("reads the production cookie in a production build", () => {
    expect(readCsrfToken("__Host-csrf_token=prod456", PROD)).toBe("prod456");
  });

  it("ignores a plain csrf_token in a production build, because anyone able to set cookies for a sibling subdomain could plant one", () => {
    expect(readCsrfToken("csrf_token=planted", PROD)).toBeUndefined();
    expect(readCsrfToken("csrf_token=planted; __Host-csrf_token=real", PROD)).toBe("real");
  });

  it("ignores the __Host- cookie in a development build", () => {
    expect(readCsrfToken("__Host-csrf_token=prod", DEV)).toBeUndefined();
  });

  it("finds the cookie among others and ignores spaces around it", () => {
    expect(readCsrfToken("theme=dark;  csrf_token=abc ; other=1", DEV)).toBe("abc");
  });

  it("ignores cookies whose names only look similar", () => {
    expect(readCsrfToken("xcsrf_token=nope", DEV)).toBeUndefined();
    expect(readCsrfToken("csrf_token_old=nope", DEV)).toBeUndefined();
    expect(readCsrfToken("refresh_token=nope", DEV)).toBeUndefined();
    expect(readCsrfToken("_Host-csrf_token=nope", PROD)).toBeUndefined();
    expect(readCsrfToken("x__Host-csrf_token=nope", PROD)).toBeUndefined();
  });

  it("ignores a cookie with an empty value", () => {
    expect(readCsrfToken("csrf_token=", DEV)).toBeUndefined();
    expect(readCsrfToken("__Host-csrf_token=", PROD)).toBeUndefined();
  });

  it("lets the first cookie of a name win, like a browser sending the most specific one first", () => {
    expect(readCsrfToken("csrf_token=first; csrf_token=second", DEV)).toBe("first");
  });

  it("keeps equals signs inside the value", () => {
    expect(readCsrfToken("csrf_token=YWJj.ZGVm==", DEV)).toBe("YWJj.ZGVm==");
  });

  it("decodes percent-encoded values", () => {
    expect(readCsrfToken("csrf_token=a%2Bb%2Fc", DEV)).toBe("a+b/c");
  });

  it("returns undefined for a value with broken percent-encoding instead of throwing", () => {
    expect(readCsrfToken("csrf_token=%E0%A4%A", DEV)).toBeUndefined();
  });

  it("reads the page's own cookies by default, with the names of the current build", () => {
    // Tests run as a development build, so the plain name is the one that counts.
    setCookie("csrf_token", "from-the-page");
    expect(readCsrfToken()).toBe("from-the-page");
  });
});
