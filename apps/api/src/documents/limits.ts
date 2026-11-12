import type { RateRule } from "../auth/limits.ts";

/** How often one signed-in person may change documents. Reads are covered by the global limit. */
export interface DocumentLimits {
  /** Per person, shared by create, edit, move and delete. Separate from the projects counter. */
  readonly writes: RateRule;
}

/** Saving happens while typing (autosave), so this is looser than the projects limit of 60. */
export const DEFAULT_DOCUMENT_LIMITS: DocumentLimits = {
  writes: { max: 120, windowSeconds: 60 },
};

/**
 * How long a change waits for the project lock before it gives up with 503. Changes are serialised per
 * project, and a waiting change holds a database connection: without a limit, a few slow changes to
 * one project could use up the whole pool and stop every other request. Five seconds is far longer
 * than a change takes (a few milliseconds), so only a real pile-up reaches it.
 */
export const DEFAULT_LOCK_TIMEOUT_MS = 5000;

/** Outline items per project. The outline is returned whole, so it must stay small. */
export const MAX_DOCUMENTS_PER_PROJECT = 1000;

/** Characters (code points) of text in one document: about 100 screenplay pages. */
export const DOCUMENT_TEXT_MAX_CHARACTERS = 200_000;

/**
 * Body limit of the routes that can carry text. Worst case: 200,000 emoji, each written in JSON as
 * two backslash-u escapes (12 characters per emoji), is 2.4 MB; this leaves room for the other fields.
 */
export const DOCUMENT_TEXT_BODY_LIMIT_BYTES = 2_621_440;
