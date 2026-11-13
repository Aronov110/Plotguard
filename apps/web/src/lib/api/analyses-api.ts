import { z } from "zod";
import { apiJson, apiRequest } from "./http.ts";

// These mirror the API's response schemas (apps/api/src/ai/schemas.ts). Every answer is checked
// when it arrives, so a changed API fails loudly here instead of showing garbage on a page.
//
// `category` and `errorCode` are plain strings on purpose: the screen words the ones it knows and
// has a plain fallback for a new one, so a new kind of problem on the server cannot break the panel.

const evidenceSchema = z.object({
  /** The item the quote is in, or `null` when the model named an item that is not in the text. */
  documentId: z.string().nullable(),
  quote: z.string(),
  /** True when the quote really occurs in that item's text. A false one may be invented. */
  verified: z.boolean(),
});

const findingSchema = z.object({
  title: z.string(),
  severity: z.enum(["major", "moderate", "minor"]),
  category: z.string(),
  explanation: z.string(),
  evidence: z.array(evidenceSchema),
  suggestion: z.string(),
});

const resultSchema = z.object({
  summary: z.string(),
  findings: z.array(findingSchema),
  read: z.object({ items: z.number().int(), characters: z.number().int() }),
});

const ideaSchema = z.object({
  title: z.string(),
  /** Plain string on purpose, like `category`: a new kind of idea must not break the panel. */
  kind: z.string(),
  description: z.string(),
  whyItFits: z.string(),
  evidence: z.array(evidenceSchema),
  /** The item the idea could go into, or `null` for the story as a whole. */
  goesIn: z.string().nullable(),
});

const ideasResultSchema = z.object({
  summary: z.string(),
  ideas: z.array(ideaSchema),
  read: z.object({ items: z.number().int(), characters: z.number().int() }),
});

const analysisBase = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  documentId: z.string().nullable(),
  scope: z.enum(["document", "project"]),
  status: z.enum(["pending", "succeeded", "failed"]),
  model: z.string(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  /** What the writer asked the ideas to be about; `null` for a plot-hole scan or no focus. */
  focus: z.string().nullable(),
  errorCode: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});

/**
 * A run. The `kind` decides the shape of the result, so a plot-hole result under the kind `ideas`
 * (or the other way round) is refused rather than shown.
 */
const analysisSchema = z.discriminatedUnion("kind", [
  analysisBase.extend({ kind: z.literal("plot_holes"), result: resultSchema.nullable() }),
  analysisBase.extend({ kind: z.literal("ideas"), result: ideasResultSchema.nullable() }),
]);

const analysisPageSchema = z.object({
  items: z.array(analysisSchema),
  nextCursor: z.string().nullable(),
});

const rangeSchema = z.object({ low: z.number(), high: z.number() });

const estimateSchema = z.object({
  /** False when the AI features are not switched on: runs cannot be started. */
  available: z.boolean(),
  model: z.string(),
  characters: z.number().int(),
  inputTokens: rangeSchema,
  outputTokens: rangeSchema,
  /** US dollars, or `null` when the model has no known price. */
  costUsd: rangeSchema.nullable(),
  fits: z.boolean(),
  maxInputTokens: z.number().int(),
  remaining: z.object({ runs: z.number().int(), tokens: z.number().int() }),
});

export type Evidence = z.infer<typeof evidenceSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type Idea = z.infer<typeof ideaSchema>;
export type Analysis = z.infer<typeof analysisSchema>;
export type PlotHoleAnalysis = Extract<Analysis, { kind: "plot_holes" }>;
export type IdeasAnalysis = Extract<Analysis, { kind: "ideas" }>;
export type AnalysisKind = Analysis["kind"];
export type AnalysisPage = z.infer<typeof analysisPageSchema>;
export type Estimate = z.infer<typeof estimateSchema>;

/** What to look at: the whole project, or one item (an act with its scenes, or a scene). */
export type AnalysisTarget =
  | { readonly scope: "project" }
  | { readonly scope: "document"; readonly documentId: string };

export interface AnalysisCallOptions {
  readonly signal?: AbortSignal;
}

/** What `estimate` is asked about besides the target. The kind is plot holes when left out. */
export interface EstimateOptions extends AnalysisCallOptions {
  readonly kind?: AnalysisKind;
}

/**
 * What `start` is asked besides the target. A focus belongs to ideas only (the server refuses it for
 * a plot-hole scan), so the type does not allow it there. Send it already cleaned up (`focusToSend`).
 */
export type StartOptions = AnalysisCallOptions &
  ({ readonly kind?: "plot_holes" } | { readonly kind: "ideas"; readonly focus?: string });

export interface ListAnalysesOptions extends AnalysisCallOptions {
  /** The `nextCursor` of the previous page. Leave it out for the first page. */
  readonly cursor?: string;
  readonly limit?: number;
}

/**
 * The AI routes the writing screen uses. All need the access token: run them through `withAuth` so
 * that an expired token is renewed once. Each call throws `ApiError`, `NetworkError` or
 * `ResponseShapeError`.
 */
export interface AnalysesApi {
  /** What a run would use and cost, and what is left of the allowance. Makes no AI call. */
  estimate(projectId: string, target: AnalysisTarget, options?: EstimateOptions): Promise<Estimate>;
  /**
   * Starts a run; it comes back `pending`. 409 means a run is already going, 422 that there is no
   * text, 413 that the text is too long, 429 that the day's allowance is used, 503 that the AI
   * features are off or the day's overall budget is used.
   */
  start(projectId: string, target: AnalysisTarget, options?: StartOptions): Promise<Analysis>;
  /** One run as it is now. */
  get(projectId: string, id: string, options?: AnalysisCallOptions): Promise<Analysis>;
  /** The runs of a project, newest first. */
  list(projectId: string, options?: ListAnalysesOptions): Promise<AnalysisPage>;
  /** Stops a run that is still going. A run that has finished comes back as it is. */
  cancel(projectId: string, id: string, options?: AnalysisCallOptions): Promise<Analysis>;
  /** Deletes a run for good. 404 means it was already gone. */
  remove(projectId: string, id: string, options?: AnalysisCallOptions): Promise<void>;
}

/**
 * The address of a project's runs. The ids come from the API's own answers, but they are encoded
 * anyway, so that nothing in them (`/`, `..`, `?`) can change which address is called.
 */
function analysesPath(projectId: string, id?: string, action?: string): string {
  const base = `/projects/${encodeURIComponent(projectId)}/analyses`;
  if (id === undefined) return base;
  const one = `${base}/${encodeURIComponent(id)}`;
  return action === undefined ? one : `${one}/${action}`;
}

function targetQuery(target: AnalysisTarget, kind: AnalysisKind): string {
  const query = new URLSearchParams({ kind, scope: target.scope });
  if (target.scope === "document") query.set("documentId", target.documentId);
  return query.toString();
}

function startBody(target: AnalysisTarget, options: StartOptions): Record<string, string> {
  const kind = options.kind ?? "plot_holes";
  const body: Record<string, string> =
    target.scope === "document"
      ? { kind, scope: "document", documentId: target.documentId }
      : { kind, scope: "project" };
  // A blank focus means none: it is left out rather than sent empty.
  if (options.kind === "ideas" && options.focus !== undefined && options.focus !== "") {
    body.focus = options.focus;
  }
  return body;
}

function withSignal(signal: AbortSignal | undefined): { signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

export const analysesApi: AnalysesApi = {
  estimate: (projectId, target, { kind = "plot_holes", signal } = {}) =>
    apiJson(`${analysesPath(projectId)}/estimate?${targetQuery(target, kind)}`, estimateSchema, {
      auth: true,
      ...withSignal(signal),
    }),

  start: (projectId, target, options = {}) =>
    apiJson(analysesPath(projectId), analysisSchema, {
      method: "POST",
      auth: true,
      json: startBody(target, options),
      ...withSignal(options.signal),
    }),

  get: (projectId, id, { signal } = {}) =>
    apiJson(analysesPath(projectId, id), analysisSchema, {
      auth: true,
      ...withSignal(signal),
    }),

  list: (projectId, { cursor, limit, signal } = {}) => {
    const query = new URLSearchParams();
    if (limit !== undefined) query.set("limit", String(limit));
    if (cursor !== undefined) query.set("cursor", cursor);
    const suffix = query.size === 0 ? "" : `?${query.toString()}`;
    return apiJson(`${analysesPath(projectId)}${suffix}`, analysisPageSchema, {
      auth: true,
      ...withSignal(signal),
    });
  },

  cancel: (projectId, id, { signal } = {}) =>
    apiJson(analysesPath(projectId, id, "cancel"), analysisSchema, {
      method: "POST",
      auth: true,
      ...withSignal(signal),
    }),

  remove: async (projectId, id, { signal } = {}) => {
    await apiRequest(analysesPath(projectId, id), {
      method: "DELETE",
      auth: true,
      ...withSignal(signal),
    });
  },
};
