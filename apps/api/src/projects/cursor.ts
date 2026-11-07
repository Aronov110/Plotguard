import { z } from "zod";

/**
 * Where a list page ended: the last project's `updated_at` and id. The next page starts after it.
 *
 * `updatedAt` is PostgreSQL's own text for the time (`2026-11-06 10:00:00.123456+00`), not a
 * JavaScript `Date`. The database keeps microseconds and a `Date` keeps only milliseconds, so a
 * `Date` would round the position and a project could appear twice or never.
 */
export interface ProjectCursor {
  readonly updatedAt: string;
  readonly id: string;
}

// Year 0001 to 9999, a real month and day count, a real clock time, and an offset like +00 or +05:30.
const TIMESTAMP_TEXT =
  /^(?!0000)(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]) ([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?[+-](0\d|1[0-5])(:[0-5]\d)?$/;

/** The regex allows day 31 in every month; PostgreSQL does not, and would fail with a 500. */
function isRealDate(text: string): boolean {
  const [year = 0, month = 0, day = 0] = text.slice(0, 10).split("-").map(Number);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  return day <= daysInMonth;
}

const cursorSchema = z.tuple([z.string().regex(TIMESTAMP_TEXT).refine(isRealDate), z.uuid()]);

/** The cursor as a URL-safe text. It is not secret and not signed (see `decodeCursor`). */
export function encodeCursor(cursor: ProjectCursor): string {
  return Buffer.from(JSON.stringify([cursor.updatedAt, cursor.id])).toString("base64url");
}

/**
 * Reads a cursor text back. Returns `undefined` for anything that is not exactly what
 * `encodeCursor` makes, so the route can answer 400. A hand-edited cursor that is still well formed
 * is accepted on purpose: the list query always filters by the signed-in person, so it can only
 * move around inside that person's own projects.
 */
export function decodeCursor(text: string): ProjectCursor | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  const result = cursorSchema.safeParse(parsed);
  if (!result.success) return undefined;
  const [updatedAt, id] = result.data;
  // Only the exact text `encodeCursor` produces counts, so there is one cursor per position.
  const cursor = { updatedAt, id };
  return encodeCursor(cursor) === text ? cursor : undefined;
}
