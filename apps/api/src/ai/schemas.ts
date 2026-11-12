import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../projects/limits.ts";
import { characters, hasNoNul, isWellFormed, unitCeiling } from "../projects/schemas.ts";

// ---------------------------------------------------------------------------------------------
// What a person may ask for
// ---------------------------------------------------------------------------------------------

/** The plot-hole finder and the idea generator. */
export const ANALYSIS_KINDS = ["plot_holes", "ideas"] as const;
export const ANALYSIS_SCOPES = ["document", "project"] as const;
export type AnalysisKind = (typeof ANALYSIS_KINDS)[number];
export type AnalysisScope = (typeof ANALYSIS_SCOPES)[number];

const kind = z.enum(ANALYSIS_KINDS, { error: "The kind must be plot_holes." });
const scope = z.enum(ANALYSIS_SCOPES, { error: "The scope must be document or project." });
const documentId = z.uuid({ error: "The document id must be a UUID." });

/**
 * A scope of `document` needs the item to look at (an act with its scenes, or a scene); a scope of
 * `project` takes every item and must not name one.
 */
function scopeMatchesDocument(value: { scope: AnalysisScope; documentId?: string | undefined }) {
  return value.scope === "document"
    ? value.documentId !== undefined
    : value.documentId === undefined;
}

/** The most characters of a focus: a sentence or two about what the ideas should be about. */
export const FOCUS_MAX_CHARACTERS = 500;

/** Characters that only disguise text: zero-width spaces, direction marks and overrides. */
const INVISIBLE = /[\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu;

/**
 * The writer's focus as one plain line: line breaks, tabs and other control characters become single
 * spaces, invisible direction marks are dropped, and the ends are trimmed. One line cannot start a
 * line of its own in the prompt.
 */
export function normalizeFocus(text: string): string {
  return text
    .replace(INVISIBLE, "")
    .replace(/[\s\p{Cc}]+/gu, " ")
    .trim();
}

const focus = z
  .string()
  .max(unitCeiling(FOCUS_MAX_CHARACTERS), { error: "The focus is too long." })
  .refine(hasNoNul, { error: "The focus cannot contain a null character." })
  .refine(isWellFormed, { error: "The focus contains an invalid character." })
  .transform(normalizeFocus)
  .refine((text) => characters(text) <= FOCUS_MAX_CHARACTERS, {
    error: `The focus can be at most ${FOCUS_MAX_CHARACTERS} characters.`,
  })
  // A blank focus means no focus, so an empty text and none at all are the same.
  .transform((text) => (text === "" ? undefined : text))
  .describe(
    `What the ideas should be about, up to ${FOCUS_MAX_CHARACTERS} characters, for ideas only. ` +
      "Line breaks become spaces.",
  );

const FOCUS_KIND_MESSAGE = "A focus is only for ideas.";

const SCOPE_MESSAGE = "Give a documentId when the scope is document, and none when it is project.";

export const createAnalysisBodySchema = z
  .strictObject({
    kind,
    scope,
    documentId: documentId.optional(),
    focus: focus.optional(),
  })
  .refine(scopeMatchesDocument, { error: SCOPE_MESSAGE, path: ["documentId"] })
  .refine((value) => value.focus === undefined || value.kind === "ideas", {
    error: FOCUS_KIND_MESSAGE,
    path: ["focus"],
  });

export const estimateQuerySchema = z
  .strictObject({
    kind,
    scope,
    documentId: documentId.optional(),
  })
  .refine(scopeMatchesDocument, { error: SCOPE_MESSAGE, path: ["documentId"] });

const PAGE_SIZE_MESSAGE = `The limit must be a whole number from 1 to ${MAX_PAGE_SIZE}.`;

export const analysesListQuerySchema = z.object({
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
    .describe(`How many analyses to return. 1 to ${MAX_PAGE_SIZE}, default ${DEFAULT_PAGE_SIZE}.`),
  cursor: z
    .string()
    .max(200, { error: "The cursor is not valid." })
    .optional()
    .describe("The `nextCursor` of the previous page."),
});

export const analysesParamsSchema = z.object({
  projectId: z.uuid({ error: "The project id must be a UUID." }),
});

export const analysisParamsSchema = analysesParamsSchema.extend({
  id: z.uuid({ error: "The analysis id must be a UUID." }),
});

// ---------------------------------------------------------------------------------------------
// What the model must answer (checked when it arrives)
// ---------------------------------------------------------------------------------------------

export const PLOT_HOLE_SEVERITIES = ["major", "moderate", "minor"] as const;
export const PLOT_HOLE_CATEGORIES = [
  "continuity",
  "timeline",
  "motivation",
  "logic",
  "setup_payoff",
  "character",
  "world_rules",
  "other",
] as const;

/** A passage that shows the problem, named by the item it is in. */
const evidenceFromModelSchema = z.object({
  documentId: z.string().describe("The id from the item header of the item the quote is in."),
  quote: z
    .string()
    .min(1)
    .max(600)
    .describe("A short passage copied exactly from that item's text. Use ... to skip words."),
});

const findingFromModelSchema = z.object({
  title: z.string().min(1).max(160).describe("The problem in a few words."),
  severity: z
    .enum(PLOT_HOLE_SEVERITIES)
    .describe("major: breaks the story. moderate: a careful reader will notice. minor: small."),
  category: z.enum(PLOT_HOLE_CATEGORIES),
  explanation: z
    .string()
    .min(1)
    .max(2000)
    .describe("What does not add up, and why it matters. Plain sentences."),
  evidence: z.array(evidenceFromModelSchema).min(1).max(5),
  suggestion: z
    .string()
    .max(1000)
    .describe("One or two ways the writer could fix it. Empty if there is no good suggestion."),
});

/** The answer the model must give for a plot-hole scan. */
export const plotHoleOutputSchema = z.object({
  summary: z
    .string()
    .max(1200)
    .describe("Two or three sentences on how well the story holds together overall."),
  findings: z.array(findingFromModelSchema).max(40),
});

export type PlotHoleOutput = z.infer<typeof plotHoleOutputSchema>;

export const IDEA_KINDS = [
  "plot_twist",
  "scene",
  "character",
  "conflict",
  "dialogue",
  "theme",
  "other",
] as const;

const ideaFromModelSchema = z.object({
  title: z.string().min(1).max(160).describe("The idea in a few words."),
  kind: z.enum(IDEA_KINDS),
  description: z
    .string()
    .min(1)
    .max(2000)
    .describe(
      "What the idea is and what it could do for the story. Plain sentences, no scene text.",
    ),
  whyItFits: z
    .string()
    .min(1)
    .max(1000)
    .describe("What the story already has that this idea builds on."),
  evidence: z.array(evidenceFromModelSchema).min(1).max(3),
  goesIn: z
    .string()
    .describe(
      "The id of the item this idea could go into, or an empty string when it is for the story as a whole.",
    ),
});

/** The answer the model must give for an idea request. */
export const ideasOutputSchema = z.object({
  summary: z
    .string()
    .max(1200)
    .describe("Two or three sentences on where the story could go from here."),
  ideas: z.array(ideaFromModelSchema).max(8),
});

export type IdeasOutput = z.infer<typeof ideasOutputSchema>;

// ---------------------------------------------------------------------------------------------
// What is stored and returned
// ---------------------------------------------------------------------------------------------

const evidenceSchema = z.object({
  /** The item the quote is in, or `null` when the model named an item that is not in the text. */
  documentId: z.string().nullable(),
  quote: z.string(),
  /** True when the quote really occurs in that item's text. A false one may be invented. */
  verified: z.boolean(),
});

const findingSchema = findingFromModelSchema.omit({ evidence: true }).extend({
  evidence: z.array(evidenceSchema),
});

export const plotHoleResultSchema = z.object({
  summary: z.string(),
  findings: z.array(findingSchema),
  /** What was read, for the cost and for the reader: how many items and characters. */
  read: z.object({ items: z.number().int(), characters: z.number().int() }),
});

export type PlotHoleResult = z.infer<typeof plotHoleResultSchema>;

const ideaSchema = ideaFromModelSchema.omit({ evidence: true, goesIn: true }).extend({
  evidence: z.array(evidenceSchema),
  /** The item the idea could go into, or `null` for the story as a whole (or an unknown item). */
  goesIn: z.string().nullable(),
});

export const ideasResultSchema = z.object({
  summary: z.string(),
  ideas: z.array(ideaSchema),
  read: z.object({ items: z.number().int(), characters: z.number().int() }),
});

export type IdeasResult = z.infer<typeof ideasResultSchema>;

/** Why a run did not finish, as a stable code the web screen words in plain language. */
export const ANALYSIS_ERROR_CODES = [
  /** The safety systems of the model declined (also after trying the fallback). */
  "refused",
  /** The answer was cut off at the output limit. */
  "truncated",
  /** The answer did not have the expected shape. */
  "invalid_output",
  /** Too many requests to the AI service just now. */
  "rate_limited",
  /** The AI service is overloaded or down. */
  "overloaded",
  /** The run took longer than allowed. */
  "timeout",
  /** The text is longer than the model can read. */
  "too_long",
  /** The server's key or access is not working. */
  "not_configured",
  /** The writer cancelled it. */
  "canceled",
  /** The server restarted while it ran. */
  "interrupted",
  /** Something else went wrong; the details are in the server's log, never here. */
  "internal",
] as const;
export type AnalysisErrorCode = (typeof ANALYSIS_ERROR_CODES)[number];

const analysisBase = z.object({
  id: z.string(),
  projectId: z.string(),
  /** The item the run looked at; `null` for the whole project, or after that item was deleted. */
  documentId: z.string().nullable(),
  scope: z.enum(ANALYSIS_SCOPES),
  status: z.enum(["pending", "succeeded", "failed"]),
  model: z.string(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  /** What the writer asked the ideas to be about; `null` for a plot-hole scan or no focus. */
  focus: z.string().nullable(),
  errorCode: z.enum(ANALYSIS_ERROR_CODES).nullable(),
  createdAt: z.string().describe("UTC, ISO 8601."),
  completedAt: z.string().nullable().describe("UTC, ISO 8601."),
});

/** A run, with a result that has the shape of its kind. */
export const analysisSchema = z.discriminatedUnion("kind", [
  analysisBase.extend({ kind: z.literal("plot_holes"), result: plotHoleResultSchema.nullable() }),
  analysisBase.extend({ kind: z.literal("ideas"), result: ideasResultSchema.nullable() }),
]);

export type AnalysisView = z.infer<typeof analysisSchema>;

export const analysisListSchema = z.object({
  items: z.array(analysisSchema),
  nextCursor: z.string().nullable(),
});

const rangeSchema = z.object({ low: z.number(), high: z.number() });

export const estimateSchema = z.object({
  /** False when the AI features are not switched on: runs cannot be started. */
  available: z.boolean(),
  model: z.string(),
  characters: z.number().int(),
  inputTokens: rangeSchema,
  outputTokens: rangeSchema,
  /** US dollars, or `null` when the model has no known price. A rough estimate, not a quote. */
  costUsd: rangeSchema.nullable(),
  /** Whether the text is short enough for one run. */
  fits: z.boolean(),
  maxInputTokens: z.number().int(),
  /** What is left of this person's allowance for the last 24 hours. */
  remaining: z.object({ runs: z.number().int(), tokens: z.number().int() }),
});

export type EstimateView = z.infer<typeof estimateSchema>;
