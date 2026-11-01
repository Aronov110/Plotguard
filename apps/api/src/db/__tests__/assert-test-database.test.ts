import { describe, expect, it } from "vitest";
import {
  adminUrlFor,
  assertTestDatabaseUrl,
  databaseName,
  TestDatabaseGuardError,
  urlForDatabase,
} from "../test-support/assert-test-database.ts";

const base = "postgres://user:pw@127.0.0.1:5433";

describe("assertTestDatabaseUrl", () => {
  it.each(["plotguard_test", "a_test", "scratch_ab12cd_test", "x1_y2_test"])(
    "accepts the test database name %s",
    (name) => {
      expect(databaseName(assertTestDatabaseUrl(`${base}/${name}`))).toBe(name);
    },
  );

  it("accepts the postgresql:// scheme", () => {
    expect(() => assertTestDatabaseUrl("postgresql://u:p@host/app_test")).not.toThrow();
  });

  it.each([
    ["the real database name", "plotguard"],
    ["a name that only contains test", "testing_data"],
    ["a name that only starts with test", "test_plotguard"],
    ["a bare _test", "_test"],
    ["the word test alone", "test"],
    ["uppercase letters", "Plotguard_test"],
    ["a trailing suffix after _test", "plotguard_test_backup"],
    ["a leading digit", "1plotguard_test"],
    ["a hyphen", "plot-guard_test"],
    ["a quote (SQL injection attempt)", 'x"; drop database plotguard; --_test'],
    ["a space", "plot guard_test"],
  ])("rejects %s", (_label, name) => {
    expect(() => assertTestDatabaseUrl(`${base}/${encodeURIComponent(name)}`)).toThrow(
      TestDatabaseGuardError,
    );
  });

  it("rejects an empty database name", () => {
    expect(() => assertTestDatabaseUrl(`${base}/`)).toThrow(TestDatabaseGuardError);
  });

  it.each([undefined, ""])("rejects a missing URL (%j)", (value) => {
    expect(() => assertTestDatabaseUrl(value)).toThrow(TestDatabaseGuardError);
  });

  it("rejects text that is not a URL", () => {
    expect(() => assertTestDatabaseUrl("not a url")).toThrow(TestDatabaseGuardError);
  });

  it("rejects a non-postgres scheme", () => {
    expect(() => assertTestDatabaseUrl("mysql://u:p@host/app_test")).toThrow(
      TestDatabaseGuardError,
    );
  });

  it("does not leak the password in its error message", () => {
    try {
      assertTestDatabaseUrl("postgres://user:hunter2-secret@host/plotguard");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as Error).message).not.toContain("hunter2-secret");
    }
  });
});

describe("adminUrlFor", () => {
  it("points at the postgres maintenance database and keeps credentials and host", () => {
    const admin = new URL(adminUrlFor(new URL(`${base}/plotguard_test`)));
    expect(admin.pathname).toBe("/postgres");
    expect(admin.username).toBe("user");
    expect(admin.password).toBe("pw");
    expect(admin.host).toBe("127.0.0.1:5433");
  });
});

describe("urlForDatabase", () => {
  it("swaps the database name when the new name is a valid test name", () => {
    const url = urlForDatabase(new URL(`${base}/plotguard_test`), "scratch_1_test");
    expect(new URL(url).pathname).toBe("/scratch_1_test");
  });

  it("refuses a name that is not a test database", () => {
    expect(() => urlForDatabase(new URL(`${base}/plotguard_test`), "plotguard")).toThrow(
      TestDatabaseGuardError,
    );
  });
});
