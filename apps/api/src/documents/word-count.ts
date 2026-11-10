/**
 * Counts words as runs of non-whitespace characters. Simple and predictable, but a simplification:
 * Chinese, Japanese and Thai are written without spaces, so a whole sentence counts as one word.
 */
export function countWords(text: string): number {
  let count = 0;
  for (const _ of text.matchAll(/\S+/gu)) count += 1;
  return count;
}
