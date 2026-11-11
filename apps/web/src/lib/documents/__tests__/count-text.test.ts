import { describe, expect, it } from "vitest";
import {
  CHARACTER_WARNING_FROM,
  charactersNearLimit,
  countCharacters,
  DOCUMENT_MAX_CHARACTERS,
} from "../count-text.ts";

describe("countCharacters", () => {
  it.each([
    ["", 0],
    ["a", 1],
    ["hello world", 11],
    ["line\nbreak\r\n", 12],
    ["é", 1],
    ["e\u0301", 2],
  ])("counts %j as %d", (text, count) => {
    expect(countCharacters(text)).toBe(count);
  });

  it("counts an emoji as one character, although it is two UTF-16 units", () => {
    expect("😀".length).toBe(2);
    expect(countCharacters("😀")).toBe(1);
    expect(countCharacters("😀😀a")).toBe(3);
  });

  it("counts right-to-left text and a family emoji's parts", () => {
    expect(countCharacters("שלום")).toBe(4);
    // A family emoji is several people joined by zero-width joiners: three people and two joiners
    // are 5 characters, however it looks on the screen.
    expect(countCharacters("👨\u200d👩\u200d👧")).toBe(5);
  });

  it("counts a very long text, as many characters as the API's limit", () => {
    expect(countCharacters("a".repeat(DOCUMENT_MAX_CHARACTERS))).toBe(DOCUMENT_MAX_CHARACTERS);
    expect(countCharacters("😀".repeat(DOCUMENT_MAX_CHARACTERS))).toBe(DOCUMENT_MAX_CHARACTERS);
  });

  it("agrees with the spread count the API uses", () => {
    const text = "a😀b𝒳c\u0301";
    expect(countCharacters(text)).toBe([...text].length);
  });
});

describe("charactersNearLimit", () => {
  it("says nothing for a short text, without counting", () => {
    expect(charactersNearLimit("a".repeat(CHARACTER_WARNING_FROM - 1))).toBeUndefined();
    expect(charactersNearLimit("")).toBeUndefined();
  });

  it("counts from the warning length on", () => {
    expect(charactersNearLimit("a".repeat(CHARACTER_WARNING_FROM))).toBe(CHARACTER_WARNING_FROM);
    expect(charactersNearLimit("a".repeat(DOCUMENT_MAX_CHARACTERS))).toBe(DOCUMENT_MAX_CHARACTERS);
  });

  it("counts emoji as characters, not as UTF-16 units", () => {
    // 100,000 emoji are 200,000 units but only 100,000 characters: well below the limit.
    expect(charactersNearLimit("😀".repeat(100_000))).toBe(100_000);
  });

  it("reports a text over the limit as it is, so the screen can say so", () => {
    expect(charactersNearLimit("a".repeat(DOCUMENT_MAX_CHARACTERS + 1))).toBe(
      DOCUMENT_MAX_CHARACTERS + 1,
    );
  });
});
