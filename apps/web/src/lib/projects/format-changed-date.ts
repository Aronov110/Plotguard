/**
 * Turns the API's timestamp (UTC, ISO 8601) into a short date for a person, such as "7 Nov 2026".
 * The day shown is the one in the reader's own time zone.
 *
 * @param locale A language tag such as `en-GB`. Leave it out to use the browser's language.
 * @param timeZone An IANA zone such as `UTC`. Leave it out to use the browser's zone.
 * @returns `undefined` when `iso` is not a date, so a screen shows nothing instead of "Invalid Date".
 */
export function formatChangedDate(
  iso: string,
  locale?: string,
  timeZone?: string,
): string | undefined {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(date);
}
