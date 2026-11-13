import { describe, expect, it } from "vitest";
import {
  countFocus,
  FOCUS_MAX_CHARACTERS,
  focusToSend,
  isFocusValid,
  normalizeFocus,
} from "../focus.ts";

// The same cases as the API's own tests (apps/api/src/ai/__tests__/ideas.test.ts). If the server's
// rule changes, change both.
describe("normalizeFocus", () => {
  it.each([
    ["  a stronger ending  ", "a stronger ending"],
    ["line one\nline two", "line one line two"],
    ["tabs\tand\r\nbreaks", "tabs and breaks"],
    ["many     spaces", "many spaces"],
    ["a b c", "a b c"],
    ["bell\u0007here", "bell here"],
    ["zero\u200bwidth", "zerowidth"],
    ["flip\u202eme", "flipme"],
    ["", ""],
    ["   \n\t ", ""],
  ])("turns %j into %j", (text, expected) => {
    expect(normalizeFocus(text)).toBe(expected);
  });

  it("keeps the joiner inside an emoji, which only looks invisible", () => {
    const family = "\u{1F468}\u200d\u{1F469}\u200d\u{1F467}";
    expect(normalizeFocus(family)).toBe(family);
  });
});

describe("countFocus and isFocusValid", () => {
  it("counts a character, not a UTF-16 unit: an emoji is one", () => {
    expect(countFocus("\u{1F600}")).toBe(1);
    expect(countFocus("\u{1F600}".repeat(500))).toBe(500);
    expect(isFocusValid("\u{1F600}".repeat(500))).toBe(true);
  });

  it("counts the cleaned text, not what was typed", () => {
    expect(countFocus("  a \n\n b  ")).toBe(3);
    expect(countFocus("x\u200b".repeat(10))).toBe(10);
  });

  it("allows exactly 500 characters and refuses 501", () => {
    expect(FOCUS_MAX_CHARACTERS).toBe(500);
    expect(isFocusValid("a".repeat(500))).toBe(true);
    expect(isFocusValid("a".repeat(501))).toBe(false);
  });

  it("does not count the spaces that cleaning removes", () => {
    expect(isFocusValid(`${"a".repeat(500)}      \n\n   `)).toBe(true);
    expect(isFocusValid(`${"a".repeat(249)}\n\n\n${"a".repeat(250)}`)).toBe(true);
    expect(isFocusValid(`${"a".repeat(250)}\n\n\n${"a".repeat(250)}`)).toBe(false);
  });

  it("accepts a blank focus", () => {
    expect(isFocusValid("")).toBe(true);
    expect(isFocusValid("   ")).toBe(true);
    expect(countFocus("   ")).toBe(0);
  });
});

describe("focusToSend", () => {
  it("sends the cleaned text", () => {
    expect(focusToSend("  a stronger\nending ")).toBe("a stronger ending");
  });

  it("sends nothing for a blank focus", () => {
    expect(focusToSend("")).toBeUndefined();
    expect(focusToSend(" \n\t\u200b ")).toBeUndefined();
  });
});
