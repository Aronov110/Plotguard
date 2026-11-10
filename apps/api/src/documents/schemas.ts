import { z } from "zod";
import { characters, hasNoNul, title, unitCeiling } from "../projects/schemas.ts";
import { DOCUMENT_TEXT_MAX_CHARACTERS, MAX_DOCUMENTS_PER_PROJECT } from "./limits.ts";

/**
 * The text of a document. Stored exactly as sent (never trimmed or cleaned): the web screen shows
 * it as text, never as HTML. A lone surrogate half (a broken emoji) cannot be stored as UTF-8 and
 * the database driver would silently replace it, so it is refused instead of altered.
 *
 * The first check is a cheap length test that stops the others (`abort`): they walk the whole
 * string, and the character count builds an array as long as the text.
 */
const content = z
  .string()
  .max(unitCeiling(DOCUMENT_TEXT_MAX_CHARACTERS), {
    error: "The text is too long.",
    abort: true,
  })
  .refine((text) => characters(text) <= DOCUMENT_TEXT_MAX_CHARACTERS, {
    error: `The text can be at most ${DOCUMENT_TEXT_MAX_CHARACTERS} characters.`,
  })
  .refine(hasNoNul, { error: "The text cannot contain a null character." })
  .refine((text) => text.isWellFormed(), { error: "The text contains an invalid character." })
  .describe(
    `Up to ${DOCUMENT_TEXT_MAX_CHARACTERS} characters. Fountain for screenplays; plain text or ` +
      "Markdown for prose. Stored as sent.",
  );

const parentId = z
  .uuid({ error: "The parent id must be a UUID." })
  .nullable()
  .describe("The act or chapter this item goes under. `null` means the top level.");

const position = z
  .number({ error: "The position must be a whole number." })
  .int({ error: "The position must be a whole number." })
  .min(0, { error: "The position cannot be negative." })
  .max(MAX_DOCUMENTS_PER_PROJECT, { error: "The position is too large." })
  .describe("Place among its siblings, counted from 0. Leave out to put it last.");

export const createDocumentBodySchema = z.strictObject({
  title,
  parentId: parentId.optional(),
  position: position.optional(),
  content: content.optional(),
});

export const patchDocumentBodySchema = z
  .strictObject({
    title: title.optional(),
    parentId: parentId.optional(),
    position: position.optional(),
    content: content.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    error: "Send at least one of title, parentId, position or content.",
  });

export const documentsParamsSchema = z.object({
  projectId: z.uuid({ error: "The project id must be a UUID." }),
});

export const documentParamsSchema = documentsParamsSchema.extend({
  id: z.uuid({ error: "The document id must be a UUID." }),
});

export const ifMatchHeadersSchema = z.object({
  "if-match": z
    .string()
    .max(64)
    .optional()
    .describe(
      'The version you loaded, as given by `ETag`, for example `"3"`. Required. `*` and lists are refused.',
    ),
});

const IDENTITY = {
  id: z.string().describe("The document's id (a UUID)."),
  parentId: z.string().nullable().describe("The id of the act or chapter above, or `null`."),
  title: z.string(),
  position: z.number().int().describe("Place among its siblings, counted from 0, without gaps."),
  wordCount: z.number().int().describe("Counted by the server: runs of non-space characters."),
  updatedAt: z.string().describe("UTC, ISO 8601."),
};

export const outlineItemSchema = z.object(IDENTITY);

export const outlineSchema = z.object({
  items: z
    .array(outlineItemSchema)
    .describe("Every item, without its text: each top-level item followed by its children."),
});

export const documentSchema = z.object({
  ...IDENTITY,
  projectId: z.string(),
  content: z.string(),
  version: z.number().int().describe("Send as `If-Match` (as `ETag`) when saving."),
  createdAt: z.string().describe("UTC, ISO 8601."),
});

export type CreateDocumentInput = z.infer<typeof createDocumentBodySchema>;
export type PatchDocumentInput = z.infer<typeof patchDocumentBodySchema>;
export type OutlineItem = z.infer<typeof outlineItemSchema>;
export type Outline = z.infer<typeof outlineSchema>;
export type DocumentView = z.infer<typeof documentSchema>;
