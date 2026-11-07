import { z } from "zod";
import { PROJECT_FORMATS } from "../db/schema/projects.ts";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./limits.ts";

export const TITLE_MAX_CHARACTERS = 200;
export const LOGLINE_MAX_CHARACTERS = 1000;

/**
 * The database counts characters (code points). JavaScript's `length` counts UTF-16 units, where an
 * emoji is two, so a title of 150 emoji would be refused although the database accepts it.
 */
const characters = (text: string): number => [...text].length;

/** PostgreSQL text cannot hold a NUL character; it would fail with a 500 instead of a 400. */
const hasNoNul = (text: string): boolean => !text.includes("\u0000");

/** Stops absurd values early; the exact limits are the checks below. 4 units cover any character. */
const unitCeiling = (maxCharacters: number): number => maxCharacters * 4;

const title = z
  .string()
  .trim()
  .max(unitCeiling(TITLE_MAX_CHARACTERS), { error: "The title is too long." })
  .refine((text) => text.length > 0, { error: "Enter a title." })
  .refine((text) => characters(text) <= TITLE_MAX_CHARACTERS, {
    error: `The title can be at most ${TITLE_MAX_CHARACTERS} characters.`,
  })
  .refine(hasNoNul, { error: "The title cannot contain a null character." })
  .describe(`1 to ${TITLE_MAX_CHARACTERS} characters. Spaces at both ends are removed.`);

/** A blank logline is stored as no logline, so an empty text and `null` mean the same. */
const logline = z
  .string()
  .trim()
  .max(unitCeiling(LOGLINE_MAX_CHARACTERS), { error: "The logline is too long." })
  .refine((text) => characters(text) <= LOGLINE_MAX_CHARACTERS, {
    error: `The logline can be at most ${LOGLINE_MAX_CHARACTERS} characters.`,
  })
  .refine(hasNoNul, { error: "The logline cannot contain a null character." })
  .describe(`Up to ${LOGLINE_MAX_CHARACTERS} characters. Blank or null means no logline.`);

const format = z.enum(PROJECT_FORMATS, { error: "The format must be screenplay, prose or other." });

export const createProjectBodySchema = z.strictObject({
  title,
  format,
  logline: logline.nullable().optional(),
});

export const patchProjectBodySchema = z
  .strictObject({
    title: title.optional(),
    format: format.optional(),
    logline: logline.nullable().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    error: "Send at least one of title, format or logline.",
  });

export const projectParamsSchema = z.object({
  id: z.uuid({ error: "The project id must be a UUID." }),
});

const PAGE_SIZE_MESSAGE = `The limit must be a whole number from 1 to ${MAX_PAGE_SIZE}.`;

export const listQuerySchema = z.object({
  limit: z
    .string()
    .regex(/^[0-9]{1,3}$/, { error: PAGE_SIZE_MESSAGE })
    .transform(Number)
    .pipe(
      z
        .number()
        .int()
        .min(1, { error: PAGE_SIZE_MESSAGE })
        .max(MAX_PAGE_SIZE, { error: PAGE_SIZE_MESSAGE }),
    )
    .optional()
    .describe(`How many projects to return. 1 to ${MAX_PAGE_SIZE}, default ${DEFAULT_PAGE_SIZE}.`),
  cursor: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .describe("The `nextCursor` of the previous page. Leave out for the first page."),
});

export const projectSchema = z.object({
  id: z.string().describe("The project's id (a UUID)."),
  title: z.string(),
  format: z.enum(PROJECT_FORMATS),
  logline: z.string().nullable(),
  createdAt: z.string().describe("UTC, ISO 8601."),
  updatedAt: z.string().describe("UTC, ISO 8601. The list is sorted by this, newest first."),
});

export const projectListSchema = z.object({
  items: z.array(projectSchema),
  nextCursor: z
    .string()
    .nullable()
    .describe("Pass as `cursor` to get the next page. `null` on the last page."),
});

export type CreateProjectInput = z.infer<typeof createProjectBodySchema>;
export type PatchProjectInput = z.infer<typeof patchProjectBodySchema>;
export type ProjectView = z.infer<typeof projectSchema>;
export type ProjectList = z.infer<typeof projectListSchema>;
