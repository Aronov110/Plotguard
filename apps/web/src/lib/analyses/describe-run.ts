import type { Analysis, Finding } from "../api/analyses-api.ts";

/** When a run was started, as a short date and time in the reader's own zone: "12 Nov 2026, 10:00". */
export function formatRunTime(iso: string, locale?: string, timeZone?: string): string | undefined {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(date);
}

/**
 * What a run looked at, in words. `titles` maps an item's id to its title, for the items that are
 * still in the outline.
 */
export function describeScope(analysis: Analysis, titles: ReadonlyMap<string, string>): string {
  if (analysis.scope === "project") return "the whole project";
  if (analysis.documentId === null) return "an item that has since been deleted";
  const title = titles.get(analysis.documentId);
  return title === undefined ? "an item that has since been deleted" : `“${title}”`;
}

/** How many findings of each severity, as a sentence: "3 findings: 1 major, 2 minor." */
export function countFindings(findings: readonly Finding[]): string {
  if (findings.length === 0) return "No findings.";
  const parts: string[] = [];
  for (const severity of ["major", "moderate", "minor"] as const) {
    const count = findings.filter((finding) => finding.severity === severity).length;
    if (count > 0) parts.push(`${count} ${severity}`);
  }
  const total = findings.length;
  return `${total} ${total === 1 ? "finding" : "findings"}: ${parts.join(", ")}.`;
}

/** How a run ended, in a word for the history list. */
export function statusWord(analysis: Analysis): string {
  if (analysis.status === "pending") return "running";
  if (analysis.status === "succeeded") {
    const count = analysis.result?.findings.length ?? 0;
    return count === 0 ? "no findings" : `${count} ${count === 1 ? "finding" : "findings"}`;
  }
  return analysis.errorCode === "canceled" ? "cancelled" : "did not finish";
}
