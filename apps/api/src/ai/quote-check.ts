/** A pattern that matches any one of the given characters, written as code numbers so it can be read. */
const anyOf = (...codes: readonly number[]): RegExp =>
  new RegExp(`[${codes.map((code) => String.fromCharCode(code)).join("")}]`, "g");

// Curly and other single quotes, curly and other double quotes, and the different dashes and minus.
const SINGLE_QUOTES = anyOf(0x2018, 0x2019, 0x201a, 0x201b, 0x2032);
const DOUBLE_QUOTES = anyOf(0x201c, 0x201d, 0x201e, 0x201f, 0x2033);
const DASHES = anyOf(0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212);
/** The single character for an ellipsis, or three or more dots in a row. */
const ELLIPSIS = new RegExp(`${String.fromCharCode(0x2026)}|[.]{3,}`);

/**
 * Quotes are checked against the real text, because a model can invent evidence that sounds right. A
 * quote is judged by what it says, not by how it was typed: capital letters, runs of spaces, line
 * breaks, curly and straight quotes and the different dashes are all treated as the same.
 */
export function normalizeForQuote(text: string): string {
  return text
    .normalize("NFC")
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The pieces of a quote the model has shortened with an ellipsis. */
function segmentsOf(quote: string): string[] {
  return quote
    .split(ELLIPSIS)
    .map((segment) => normalizeForQuote(segment))
    .filter((segment) => segment !== "");
}

/**
 * True when every piece of the quote occurs in the text, in the order given. A quote with nothing in
 * it (or only an ellipsis) is not a quote and is never verified.
 */
export function quoteAppearsIn(quote: string, text: string): boolean {
  const segments = segmentsOf(quote);
  if (segments.length === 0) return false;
  const haystack = normalizeForQuote(text);
  let from = 0;
  for (const segment of segments) {
    const at = haystack.indexOf(segment, from);
    if (at === -1) return false;
    from = at + segment.length;
  }
  return true;
}
