import { describe, expect, it } from "vitest";
import { clearAccessToken, getAccessToken, setAccessToken } from "../token-store.ts";

describe("token store", () => {
  it("starts empty", () => {
    expect(getAccessToken()).toBeUndefined();
  });

  it("returns the token that was set", () => {
    setAccessToken("token-one");
    expect(getAccessToken()).toBe("token-one");
  });

  it("replaces an earlier token", () => {
    setAccessToken("token-one");
    setAccessToken("token-two");
    expect(getAccessToken()).toBe("token-two");
  });

  it("forgets the token when cleared", () => {
    setAccessToken("token-one");
    clearAccessToken();
    expect(getAccessToken()).toBeUndefined();
  });

  it("can be cleared when already empty", () => {
    expect(() => clearAccessToken()).not.toThrow();
  });

  it("never writes the token to any browser storage or cookie", () => {
    setAccessToken("super-secret-token-value");

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).not.toContain("super-secret-token-value");
    const everything = JSON.stringify({ ...window.localStorage, ...window.sessionStorage });
    expect(everything).not.toContain("super-secret-token-value");
  });
});
