import { describe, expect, it } from "vitest";
import { normalizeForQuote, quoteAppearsIn } from "../quote-check.ts";

const text = (...codes: number[]) => String.fromCharCode(...codes);
const CURLY_OPEN = text(0x201c);
const CURLY_CLOSE = text(0x201d);
const CURLY_APOSTROPHE = text(0x2019);
const EN_DASH = text(0x2013);
const EM_DASH = text(0x2014);
const ELLIPSIS = text(0x2026);
const NO_BREAK_SPACE = text(0xa0);

describe("normalizeForQuote", () => {
  it("treats capital letters and small letters as the same", () => {
    expect(normalizeForQuote("The KEEPER Climbs")).toBe("the keeper climbs");
  });

  it("collapses spaces, tabs, line breaks and non-breaking spaces into one space, and trims", () => {
    expect(normalizeForQuote(`  one \t two\n\nthree${NO_BREAK_SPACE}four  `)).toBe(
      "one two three four",
    );
  });

  it("turns curly quotes into straight ones", () => {
    expect(normalizeForQuote(`${CURLY_OPEN}Don${CURLY_APOSTROPHE}t,${CURLY_CLOSE} she said`)).toBe(
      '"don\'t," she said',
    );
  });

  it("turns the different dashes into a hyphen", () => {
    expect(normalizeForQuote(`a${EN_DASH}b${EM_DASH}c`)).toBe("a-b-c");
  });

  it("joins a letter written with a combining accent to the single character", () => {
    expect(normalizeForQuote(`e${text(0x301)}`)).toBe(normalizeForQuote(text(0xe9)));
  });

  it("keeps emoji and right-to-left text", () => {
    expect(normalizeForQuote("\u{1f600} שלום")).toBe("\u{1f600} שלום");
  });
});

describe("quoteAppearsIn", () => {
  const scene = [
    "INT. LIGHTHOUSE - NIGHT",
    "",
    `The keeper climbs the stairs. ${CURLY_OPEN}Nobody${CURLY_APOSTROPHE}s coming,${CURLY_CLOSE} he says.`,
    "The lamp turns.",
  ].join("\n");

  it("finds a quote that is in the text", () => {
    expect(quoteAppearsIn("The keeper climbs the stairs.", scene)).toBe(true);
  });

  it("finds it however it was typed: other capitals, other spacing, straight quotes", () => {
    expect(quoteAppearsIn("the KEEPER   climbs\nthe stairs", scene)).toBe(true);
    expect(quoteAppearsIn('"Nobody\'s coming," he says', scene)).toBe(true);
    expect(quoteAppearsIn("int. lighthouse - night", scene)).toBe(true);
  });

  it("finds a quote that runs over a line break", () => {
    expect(quoteAppearsIn("he says. The lamp turns.", scene)).toBe(true);
  });

  it("does not find a quote that is not in the text", () => {
    expect(quoteAppearsIn("The keeper descends the stairs.", scene)).toBe(false);
    expect(quoteAppearsIn("a completely invented line", scene)).toBe(false);
  });

  it("does not find a quote whose words are there but in another order", () => {
    expect(quoteAppearsIn("stairs the climbs keeper", scene)).toBe(false);
  });

  it("does not accept an empty quote, or one of only spaces or an ellipsis", () => {
    expect(quoteAppearsIn("", scene)).toBe(false);
    expect(quoteAppearsIn("   \n ", scene)).toBe(false);
    expect(quoteAppearsIn(ELLIPSIS, scene)).toBe(false);
    expect(quoteAppearsIn("...", scene)).toBe(false);
    expect(quoteAppearsIn(` ${ELLIPSIS} ${ELLIPSIS} `, scene)).toBe(false);
  });

  describe("a quote shortened with an ellipsis", () => {
    it("needs every piece to be there, in order", () => {
      expect(quoteAppearsIn(`The keeper climbs ${ELLIPSIS} The lamp turns.`, scene)).toBe(true);
      expect(quoteAppearsIn("The keeper climbs ... The lamp turns.", scene)).toBe(true);
      expect(quoteAppearsIn("The keeper climbs.... The lamp turns", scene)).toBe(true);
    });

    it("fails when a piece is missing", () => {
      expect(quoteAppearsIn(`The keeper climbs ${ELLIPSIS} The lamp goes out.`, scene)).toBe(false);
    });

    it("fails when the pieces are in the wrong order", () => {
      expect(quoteAppearsIn(`The lamp turns ${ELLIPSIS} The keeper climbs`, scene)).toBe(false);
    });

    it("does not let one piece of the text satisfy two pieces of the quote", () => {
      expect(quoteAppearsIn(`The lamp turns ${ELLIPSIS} The lamp turns`, scene)).toBe(false);
    });

    it("accepts a leading or trailing ellipsis", () => {
      expect(quoteAppearsIn(`${ELLIPSIS} climbs the stairs`, scene)).toBe(true);
      expect(quoteAppearsIn(`The keeper climbs ${ELLIPSIS}`, scene)).toBe(true);
    });
  });

  it("works on a very long text and a quote at its very end", () => {
    const long = `${"word ".repeat(200_000)}the very end`;
    expect(quoteAppearsIn("the very end", long)).toBe(true);
    expect(quoteAppearsIn("the very start", long)).toBe(false);
  });
});
