import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { findPgError, isLockTimeout, isUniqueViolation } from "../pg-errors.ts";

const driver = (code: string, constraint?: string) =>
  Object.assign(new Error("driver error"), { code, severity: "ERROR", constraint });

describe("findPgError", () => {
  it("finds the driver error inside a Drizzle error", () => {
    const wrapped = new DrizzleQueryError("insert ...", [], driver("23505", "users_email_unique"));
    expect(findPgError(wrapped)).toEqual({ code: "23505", constraint: "users_email_unique" });
  });

  it("reads a driver error directly", () => {
    expect(findPgError(driver("23514", "some_check"))).toEqual({
      code: "23514",
      constraint: "some_check",
    });
  });

  it("works without a constraint name", () => {
    expect(findPgError(driver("22P02"))).toEqual({ code: "22P02" });
  });

  it("follows a longer chain of causes", () => {
    const deep = new Error("a", { cause: new Error("b", { cause: driver("23505", "c") }) });
    expect(findPgError(deep)?.code).toBe("23505");
  });

  it("gives up after a few levels and survives a circular chain", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as { cause?: unknown }).cause = b;
    expect(findPgError(a)).toBeUndefined();
  });

  it.each([
    ["a plain error", new Error("nope")],
    ["a string", "23505"],
    ["null", null],
    ["undefined", undefined],
    ["a number", 23505],
    ["an error with a Node-style code", Object.assign(new Error("x"), { code: "ECONNREFUSED" })],
    [
      "an error with a code that is not 5 characters",
      Object.assign(new Error("x"), { code: "235" }),
    ],
  ])("returns undefined for %s", (_label, value) => {
    expect(findPgError(value)).toBeUndefined();
  });
});

describe("isUniqueViolation", () => {
  const dup = new DrizzleQueryError("insert", [], driver("23505", "users_email_unique"));

  it("is true for a unique violation", () => {
    expect(isUniqueViolation(dup)).toBe(true);
  });

  it("can be limited to one constraint", () => {
    expect(isUniqueViolation(dup, "users_email_unique")).toBe(true);
    expect(isUniqueViolation(dup, "refresh_sessions_token_hash_unique")).toBe(false);
  });

  it("is false for other database errors", () => {
    expect(isUniqueViolation(driver("23503", "fk"))).toBe(false);
    expect(isUniqueViolation(driver("23514", "check"))).toBe(false);
  });

  it("is false for things that are not database errors", () => {
    expect(isUniqueViolation(new Error("x"))).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});

describe("isLockTimeout", () => {
  it("is true for the error PostgreSQL gives when lock_timeout runs out (55P03)", () => {
    expect(isLockTimeout(driver("55P03"))).toBe(true);
  });

  it("finds it inside a Drizzle error, where the driver error is the cause", () => {
    const wrapped = new DrizzleQueryError("update ...", [], driver("55P03"));
    expect(isLockTimeout(wrapped)).toBe(true);
  });

  it("is false for other database errors, even similar ones", () => {
    expect(isLockTimeout(driver("23505", "users_email_unique"))).toBe(false);
    expect(isLockTimeout(driver("40P01"))).toBe(false); // deadlock detected
    expect(isLockTimeout(driver("57014"))).toBe(false); // statement_timeout: query canceled
    expect(isLockTimeout(driver("55P04"))).toBe(false);
  });

  it("is false for errors that are not database errors, and for things that are not errors", () => {
    expect(isLockTimeout(new Error("55P03"))).toBe(false);
    expect(isLockTimeout(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe(false);
    expect(isLockTimeout(undefined)).toBe(false);
    expect(isLockTimeout(null)).toBe(false);
    expect(isLockTimeout("55P03")).toBe(false);
  });
});
