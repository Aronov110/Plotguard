import { describe, expect, it } from "vitest";
import { formatEtag, parseIfMatch } from "../etag.ts";

describe("formatEtag", () => {
  it("puts the version in double quotes", () => {
    expect(formatEtag(1)).toBe('"1"');
    expect(formatEtag(123)).toBe('"123"');
  });
});

describe("parseIfMatch", () => {
  it("reports a missing header", () => {
    expect(parseIfMatch(undefined)).toEqual({ kind: "missing" });
  });

  it.each([
    ['"1"', 1],
    ['"42"', 42],
    ['W/"7"', 7],
    ['  "3"  ', 3],
    ['"999999999"', 999_999_999],
  ])("reads %s as version %d", (header, version) => {
    expect(parseIfMatch(header)).toEqual({ kind: "version", version });
  });

  it("round-trips what formatEtag makes", () => {
    for (const version of [1, 2, 10, 999_999_999]) {
      expect(parseIfMatch(formatEtag(version))).toEqual({ kind: "version", version });
    }
  });

  it.each([
    "*",
    '"1", "2"',
    '"1","2"',
    "1",
    '""',
    '"0"',
    '"-1"',
    '"1.5"',
    '"01"',
    '"abc"',
    '"1e3"',
    '"0x10"',
    '"1000000000"',
    '" 1"',
    '"1 "',
    'w/"1"',
    'W/ "1"',
    '"1',
    '1"',
    "",
    "   ",
    '"1"x',
    'x"1"',
    'W/W/"1"',
    '"１"',
  ])("calls %j malformed", (header) => {
    expect(parseIfMatch(header)).toEqual({ kind: "malformed" });
  });
});
