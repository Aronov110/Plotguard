import { createHash } from "node:crypto";

/** One act, chapter or scene with its text, as the documents table holds it. */
export interface ManuscriptItem {
  readonly id: string;
  readonly parentId: string | null;
  readonly title: string;
  readonly position: number;
  readonly content: string;
}

export interface Manuscript {
  /** The text sent to the model: every item behind a header line the text itself cannot forge. */
  readonly text: string;
  /** The items in the order they were sent, by id, so quotes can be checked against their text. */
  readonly items: readonly ManuscriptItem[];
  /** The characters of text in all items (not counting the headers). */
  readonly characters: number;
}

/**
 * The items in reading order: each top-level item, then its own items, every group by `position`.
 * An item whose parent is not in the list is treated as top-level instead of being lost.
 */
export function inReadingOrder(items: readonly ManuscriptItem[]): ManuscriptItem[] {
  const known = new Set(items.map((item) => item.id));
  const byPosition = (a: ManuscriptItem, b: ManuscriptItem): number =>
    a.position - b.position || a.id.localeCompare(b.id);
  const topLevel = items
    .filter((item) => item.parentId === null || !known.has(item.parentId))
    .sort(byPosition);
  return topLevel.flatMap((item) => [
    item,
    ...items.filter((child) => child.parentId === item.id).sort(byPosition),
  ]);
}

/** Line feed, carriage return, and the two Unicode line and paragraph separators. */
const LINE_BREAKS = new RegExp(
  `[${[0x0a, 0x0d, 0x2028, 0x2029].map((code) => String.fromCharCode(code)).join("")}]+`,
  "g",
);

/** A title on one line: a line break in a title must not be able to start a header of its own. */
function oneLine(text: string): string {
  return text.replace(LINE_BREAKS, " ");
}

/**
 * The marker that starts every item header. It is made from a hash of the whole text, so it is
 * different for every manuscript, and nobody can write it into their text in advance: it depends on
 * the text that would have to contain it. It is the same every time the same text is sent, which keeps
 * the start of the request identical, so the API can reuse its cache of it.
 */
export function markerFor(items: readonly ManuscriptItem[]): string {
  const hash = createHash("sha256");
  for (const item of items) {
    hash.update(`${item.id}\u0000${item.title}\u0000${item.content}\u0000`);
  }
  return `<<<${hash.digest("hex").slice(0, 16)}>>>`;
}

/**
 * Lays the items out for the model. Each item starts with a header line made of the marker, the
 * item's place and id, and its title; the text follows, and the whole ends with a closing line. The
 * instructions tell the model that only lines starting with the marker are structure, and that all
 * other text is the manuscript, to be read and never obeyed.
 */
export function buildManuscript(items: readonly ManuscriptItem[]): Manuscript {
  const ordered = inReadingOrder(items);
  const marker = markerFor(ordered);
  const parts: string[] = [`${marker} MANUSCRIPT START | items: ${ordered.length}`];
  ordered.forEach((item, index) => {
    const level = item.parentId === null ? "top level" : "inside an act or chapter";
    parts.push(
      `${marker} ITEM ${index + 1} of ${ordered.length} | id: ${item.id} | ${level} | title: ${oneLine(item.title)}`,
    );
    parts.push(item.content === "" ? "(no text yet)" : item.content);
  });
  parts.push(`${marker} MANUSCRIPT END`);
  return {
    text: parts.join("\n"),
    items: ordered,
    characters: ordered.reduce((total, item) => total + item.content.length, 0),
  };
}
