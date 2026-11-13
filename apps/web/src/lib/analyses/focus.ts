/**
 * The rules for the focus of an idea request, copied from the API (`apps/api/src/ai/schemas.ts`) so
 * that the panel counts and cleans the text the way the server does. Where the two disagree the
 * screen would block a focus the server accepts, or send one the server refuses.
 */

/** The most characters of a focus. */
export const FOCUS_MAX_CHARACTERS = 500;

/**
 * The most the field takes at all. It is well above the limit so that a writer who goes over sees the
 * count and the message, but a huge paste cannot fill the page or the request.
 */
export const FOCUS_INPUT_CEILING = 2000;

/** Characters that only disguise text: zero-width spaces, direction marks and overrides. */
const INVISIBLE = /[\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu;

/**
 * The focus as the server reads it: one plain line. Line breaks, tabs and other control characters
 * become single spaces, invisible direction marks are dropped, and the ends are trimmed.
 */
export function normalizeFocus(text: string): string {
  return text
    .replace(INVISIBLE, "")
    .replace(/[\s\p{Cc}]+/gu, " ")
    .trim();
}

/** How many characters the server counts in this focus. An emoji is one character, not two. */
export function countFocus(text: string): number {
  return [...normalizeFocus(text)].length;
}

/** What the writer typed, cleaned up for sending: `undefined` when it is blank (no focus). */
export function focusToSend(text: string): string | undefined {
  const clean = normalizeFocus(text);
  return clean === "" ? undefined : clean;
}

/** Whether the focus is short enough. A blank focus is fine: it means none. */
export function isFocusValid(text: string): boolean {
  return countFocus(text) <= FOCUS_MAX_CHARACTERS;
}
