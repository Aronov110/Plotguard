import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../projects/limits.ts";

// ---------------------------------------------------------------------------------------------
// What a person may ask for
// ---------------------------------------------------------------------------------------------

/** Only the plot-hole finder exists so far; the idea generator joins it in a later step. */
export const ANALYSIS_KINDS = ["plot_holes"] as const;
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

const SCOPE_MESSAGE = "Give a documentId when the scope is document, and none when it is project.";

export const createAnalysisBodySchema = z
  .strictObject({
    kind,
    scope,
    documentId: documentId.optional(),
  })
  .refine(scopeMatchesDocument, { error: SCOPE_MESSAGE, path: ["documentId"] });

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

export const analysisSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  /** The item the run looked at; `null` for the whole project, or after that item was deleted. */
  documentId: z.string().nullable(),
  kind: z.enum(ANALYSIS_KINDS),
  scope: z.enum(ANALYSIS_SCOPES),
  status: z.enum(["pending", "succeeded", "failed"]),
  model: z.string(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  result: plotHoleResultSchema.nullable(),
  errorCode: z.enum(ANALYSIS_ERROR_CODES).nullable(),
  createdAt: z.string().describe("UTC, ISO 8601."),
  completedAt: z.string().nullable().describe("UTC, ISO 8601."),
});

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
