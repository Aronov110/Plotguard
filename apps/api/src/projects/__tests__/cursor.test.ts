import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "../cursor.ts";

const ID = "019e5a3c-1b2d-7c4e-8f10-a1b2c3d4e5f6";
const TIME = "2026-11-06 10:00:00.123456+00";

/** Builds a cursor text from any JSON value, the way `encodeCursor` would, to test bad content. */
const raw = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

describe("project cursor: round trip", () => {
  it("gives back what it was given", () => {
    expect(decodeCursor(encodeCursor({ updatedAt: TIME, id: ID }))).toEqual({
      updatedAt: TIME,
      id: ID,
    });
  });

  it.each([
    "2026-11-06 10:00:00+00",
    "2026-11-06 10:00:00.1+00",
    "2026-11-06 10:00:00.123+00",
    "2026-11-06 10:00:00.999999+00",
    "2026-11-06 12:00:00.5+02",
    "2026-11-06 05:30:00.5+05:30",
    "2026-11-06 10:00:00-03",
    "2024-02-29 23:59:59.999999+00",
    "0001-01-01 00:00:00+00",
    "9999-12-31 23:59:59.999999+00",
  ])("keeps the time exactly as the database wrote it: %s", (updatedAt) => {
    expect(decodeCursor(encodeCursor({ updatedAt, id: ID }))).toEqual({ updatedAt, id: ID });
  });

  it("keeps microseconds that a JavaScript Date would round away", () => {
    const first = encodeCursor({ updatedAt: "2026-11-06 10:00:00.123456+00", id: ID });
    const second = encodeCursor({ updatedAt: "2026-11-06 10:00:00.123457+00", id: ID });
    expect(first).not.toBe(second);
    expect(decodeCursor(first)?.updatedAt).toBe("2026-11-06 10:00:00.123456+00");
    expect(decodeCursor(second)?.updatedAt).toBe("2026-11-06 10:00:00.123457+00");
  });

  it("makes text that is safe in a URL", () => {
    expect(encodeCursor({ updatedAt: TIME, id: ID })).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("project cursor: what is refused", () => {
  it.each([
    ["an empty text", ""],
    ["plain words", "hello"],
    ["a text with a space", "abc def"],
    ["a text with padding", `${encodeCursor({ updatedAt: TIME, id: ID })}=`],
    ["a text with a slash", "ab/cd"],
    ["a text with a plus", "ab+cd"],
    ["a percent sign", "%41%42"],
    ["a script tag", "<script>alert(1)</script>"],
    ["an SQL fragment", "'; drop table projects; --"],
    ["a NUL character", "ab\u0000cd"],
    ["base64 that is not JSON", Buffer.from("not json").toString("base64url")],
    ["a truncated cursor", encodeCursor({ updatedAt: TIME, id: ID }).slice(0, 20)],
  ])("refuses %s", (_name, text) => {
    expect(decodeCursor(text)).toBeUndefined();
  });

  it.each([
    ["JSON null", null],
    ["a number", 5],
    ["a string", "text"],
    ["an object", { updatedAt: TIME, id: ID }],
    ["an empty array", []],
    ["one element", [TIME]],
    ["three elements", [TIME, ID, "extra"]],
    ["numbers in the pair", [1, 2]],
    ["a time as a number", [1730000000000, ID]],
    ["the pair in the wrong order", [ID, TIME]],
    ["an id that is not a UUID", [TIME, "not-a-uuid"]],
    ["a time in ISO form with T", ["2026-11-06T10:00:00.123Z", ID]],
    ["a time without an offset", ["2026-11-06 10:00:00", ID]],
    ["seven decimals", ["2026-11-06 10:00:00.1234567+00", ID]],
  ])("refuses JSON that is %s", (_name, value) => {
    expect(decodeCursor(raw(value))).toBeUndefined();
  });

  it.each([
    "2026-13-01 10:00:00+00",
    "2026-00-10 10:00:00+00",
    "2026-02-30 10:00:00+00",
    "2026-02-29 10:00:00+00",
    "1900-02-29 10:00:00+00",
    "2026-04-31 10:00:00+00",
    "2026-11-00 10:00:00+00",
    "2026-11-32 10:00:00+00",
    "2026-11-06 24:00:00+00",
    "2026-11-06 10:60:00+00",
    "2026-11-06 10:00:60+00",
    "0000-01-01 00:00:00+00",
    "2026-11-06 10:00:00+16",
    "2026-11-06 10:00:00+00:60",
  ])("refuses a time that is not real, which the database would fail on: %s", (updatedAt) => {
    expect(decodeCursor(raw([updatedAt, ID]))).toBeUndefined();
  });

  it("accepts a real leap day", () => {
    expect(decodeCursor(encodeCursor({ updatedAt: "2000-02-29 10:00:00+00", id: ID }))).toEqual({
      updatedAt: "2000-02-29 10:00:00+00",
      id: ID,
    });
  });

  it("refuses a cursor that decodes but is not written the way this code writes it", () => {
    // The same pair with spaces inside the JSON: valid JSON, valid values, different text.
    const spaced = Buffer.from(JSON.stringify([TIME, ID], null, 1)).toString("base64url");
    expect(decodeCursor(spaced)).toBeUndefined();
  });

  it("refuses a very long text without trouble", () => {
    expect(decodeCursor("A".repeat(100_000))).toBeUndefined();
  });
});
