/** The most characters the API accepts in one document. Keep in line with the API's own limit. */
export const DOCUMENT_MAX_CHARACTERS = 200_000;

/** From this many characters on, the screen tells the writer how close the limit is. */
export const CHARACTER_WARNING_FROM = 190_000;

/**
 * How many characters a text has, counted the way the API counts them: an emoji (two UTF-16 units)
 * is one character. A loop instead of `[...text].length`: it makes no array as long as the text.
 */
export function countCharacters(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

/**
 * The number of characters, but only when the text is long enough to be near the limit; otherwise
 * `undefined`. Characters are never more than UTF-16 units, so a shorter text cannot be near it, and
 * the count (a pass over the whole text) is then not worth making after every keystroke.
 */
export function charactersNearLimit(text: string): number | undefined {
  return text.length < CHARACTER_WARNING_FROM ? undefined : countCharacters(text);
}
