import { describe, expect, it } from "vitest";
import { countWords } from "../word-count.ts";

describe("countWords", () => {
  it.each([
    ["", 0],
    ["   ", 0],
    ["\n\t \r\n", 0],
    ["one", 1],
    ["one two", 2],
    ["  one   two  ", 2],
    ["one\ntwo\r\nthree\tfour", 4],
    ["well-known", 1],
    ["don't stop", 2],
    ["INT. LIGHTHOUSE - NIGHT", 4],
    ["a\u00a0b", 2],
    ["a\u2003b", 2],
    ["😀 😀", 2],
    ["e\u0301 x", 2],
  ])("counts %j as %d", (text, words) => {
    expect(countWords(text)).toBe(words);
  });

  it("counts a text without spaces as one word (the documented simplification)", () => {
    expect(countWords("これは日本語の文章です")).toBe(1);
  });

  it("handles a very long text", () => {
    expect(countWords("word ".repeat(200_000 / 5))).toBe(40_000);
  });
});
