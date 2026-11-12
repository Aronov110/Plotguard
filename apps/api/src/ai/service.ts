import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import { findPgError, isUniqueViolation } from "../db/pg-errors.ts";
import { type AiAnalysis, aiAnalyses } from "../db/schema/ai-analyses.ts";
import { documents } from "../db/schema/documents.ts";
import { projects } from "../db/schema/projects.ts";
import { decodeCursor, encodeCursor } from "../projects/cursor.ts";
import { DEFAULT_PAGE_SIZE } from "../projects/limits.ts";
import { InvalidCursorError } from "../projects/service.ts";
import { type AiClient, AiProviderError, type AiUsage } from "./client.ts";
import {
  AiUnavailableError,
  DailyLimitError,
  GlobalBudgetError,
  ManuscriptEmptyError,
  ManuscriptTooLargeError,
  RunInProgressError,
} from "./errors.ts";
import { estimateRun } from "./estimate.ts";
import { type AiConfig, USAGE_WINDOW_HOURS } from "./limits.ts";
import { buildManuscript, type Manuscript, type ManuscriptItem } from "./manuscript.ts";
import { manuscriptPreface, plotHoleTask, SYSTEM_PROMPT } from "./prompts/plot-holes.ts";
import { quoteAppearsIn } from "./quote-check.ts";
import {
  type AnalysisErrorCode,
  type AnalysisKind,
  type AnalysisScope,
  type AnalysisView,
  type EstimateView,
  type PlotHoleOutput,
  type PlotHoleResult,
  plotHoleOutputSchema,
  plotHoleResultSchema,
} from "./schemas.ts";

const ONE_PENDING_INDEX = "ai_analyses_one_pending_per_user_idx";

export interface AnalysisTarget {
  readonly kind: AnalysisKind;
  readonly scope: AnalysisScope;
  /** The item to look at, for a scope of `document`. */
  readonly documentId?: string | undefined;
}

export interface AiServiceOptions {
  /** The model call. Without one, the AI features are off. */
  readonly client?: AiClient | undefined;
  readonly config: AiConfig;
  /** The kill switch: `false` switches the features off even when there is a client. */
  readonly enabled: boolean;
  /**
   * Hears about an unexpected failure of a background run. It receives only what is safe to log: a
   * database error carries the query and its values, and those can hold the writer's text.
   */
  readonly onUnexpectedError?: (details: Readonly<Record<string, unknown>>) => void;
}

export interface AnalysisPage {
  readonly items: AnalysisView[];
  readonly nextCursor: string | null;
}

export interface AiService {
  /** Whether runs can be started: a client is set up and the features are switched on. */
  readonly available: boolean;
  /** What a run would use and cost, and what is left of the person's allowance. */
  estimate(
    userId: string,
    projectId: string,
    target: AnalysisTarget,
  ): Promise<EstimateView | undefined>;
  /**
   * Starts a run and returns it as `pending` at once; the run goes on in the background.
   * @returns `undefined` if the project (or the item) is not the person's.
   */
  start(
    userId: string,
    projectId: string,
    target: AnalysisTarget,
  ): Promise<AnalysisView | undefined>;
  get(userId: string, projectId: string, id: string): Promise<AnalysisView | undefined>;
  list(
    userId: string,
    projectId: string,
    page: { readonly limit?: number | undefined; readonly cursor?: string | undefined },
  ): Promise<AnalysisPage | undefined>;
  /** Stops a run in progress (it ends as failed, `canceled`). A finished run is returned as it is. */
  cancel(userId: string, projectId: string, id: string): Promise<AnalysisView | undefined>;
  /** Deletes an analysis, stopping it first if it is running. */
  remove(userId: string, projectId: string, id: string): Promise<boolean>;
  /**
   * Fails every run that is still `pending`, as `interrupted`. Call it once when the server starts:
   * the runs go on inside this process, so one left pending by a restart will never finish.
   */
  sweepInterrupted(): Promise<number>;
  /** Waits for the runs in progress to end. For tests. */
  idle(): Promise<void>;
  /**
   * For a shutdown: stops every run in progress at once (each ends as failed, `interrupted`) and
   * waits for them to be written down, so the database can then be closed. It does not wait for the
   * model, which could take minutes.
   */
  shutdown(): Promise<void>;
}

interface Running {
  readonly controller: AbortController;
  readonly promise: Promise<void>;
  canceled: boolean;
  timedOut: boolean;
  /** The server is shutting down. */
  interrupted: boolean;
}

/** What is safe to log about a failure: names and codes, never the message or the values. */
function describeForLog(error: unknown): Record<string, unknown> {
  const cause = error instanceof Error ? error.cause : undefined;
  return {
    name: error instanceof Error ? error.name : typeof error,
    ...(error instanceof AiProviderError ? { code: error.code } : {}),
    ...(cause instanceof Error ? { causeName: cause.name } : {}),
    ...(findPgError(error) === undefined ? {} : { pgCode: findPgError(error)?.code }),
  };
}

function codeFor(error: unknown): AnalysisErrorCode {
  if (error instanceof AiProviderError) {
    switch (error.code) {
      case "rate_limited":
        return "rate_limited";
      case "overloaded":
      case "unavailable":
        return "overloaded";
      case "timeout":
        return "timeout";
      case "too_long":
        return "too_long";
      case "not_configured":
        return "not_configured";
      case "canceled":
        return "canceled";
    }
  }
  return "internal";
}

/** Everything the model's answer is checked against: the ids it may name, and each item's text. */
function verify(output: PlotHoleOutput, manuscript: Manuscript): PlotHoleResult {
  const textOf = new Map(manuscript.items.map((item) => [item.id, item.content]));
  return {
    summary: output.summary,
    findings: output.findings.map((finding) => ({
      ...finding,
      evidence: finding.evidence.map((entry) => {
        const text = textOf.get(entry.documentId);
        return {
          documentId: text === undefined ? null : entry.documentId,
          quote: entry.quote,
          verified: text !== undefined && quoteAppearsIn(entry.quote, text),
        };
      }),
    })),
    read: { items: manuscript.items.length, characters: manuscript.characters },
  };
}

function totalInput(usage: AiUsage): number {
  return usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}

function toView(row: AiAnalysis): AnalysisView {
  const parsed = row.result === null ? undefined : plotHoleResultSchema.safeParse(row.result);
  return {
    id: row.id,
    projectId: row.projectId,
    documentId: row.documentId,
    kind: row.kind as AnalysisKind,
    scope: row.scope as AnalysisScope,
    status: row.status,
    model: row.model,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    result: parsed?.success ? parsed.data : null,
    errorCode: row.errorCode as AnalysisErrorCode | null,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt === null ? null : row.completedAt.toISOString(),
  };
}

export function createAiService(db: Database, options: AiServiceOptions): AiService {
  const { client, config } = options;
  const available = options.enabled && client !== undefined;
  const running = new Map<string, Running>();

  async function ownsProject(userId: string, projectId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
    return row !== undefined;
  }

  /** The characters of text in the scope, and whether any of it is more than white space. */
  async function measure(
    projectId: string,
    target: AnalysisTarget,
  ): Promise<{ characters: number; hasText: boolean } | undefined> {
    const inScope =
      target.scope === "project"
        ? eq(documents.projectId, projectId)
        : and(
            eq(documents.projectId, projectId),
            or(
              eq(documents.id, target.documentId ?? ""),
              eq(documents.parentId, target.documentId ?? ""),
            ),
          );
    if (target.scope === "document") {
      const [exists] = await db
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.projectId, projectId), eq(documents.id, target.documentId ?? "")));
      if (exists === undefined) return undefined;
    }
    const [row] = await db
      .select({
        characters: sql<number>`coalesce(sum(char_length(${documents.content})), 0)::bigint`,
        hasText: sql<boolean>`coalesce(bool_or(${documents.content} ~ '\\S'), false)`,
      })
      .from(documents)
      .where(inScope);
    return { characters: Number(row?.characters ?? 0), hasText: row?.hasText ?? false };
  }

  /** The runs and tokens of one person (or, without `userId`, of everybody) in the last day. */
  async function usageInWindow(userId?: string) {
    const [row] = await db
      .select({
        runs: sql<number>`count(*)::int`,
        tokens: sql<number>`coalesce(sum(${aiAnalyses.inputTokens} + ${aiAnalyses.outputTokens}), 0)::bigint`,
        secondsUntilOldestLeaves: sql<
          number | null
        >`extract(epoch from (min(${aiAnalyses.createdAt}) + make_interval(hours => ${USAGE_WINDOW_HOURS}) - now()))`,
      })
      .from(aiAnalyses)
      .where(
        and(
          userId === undefined ? undefined : eq(aiAnalyses.userId, userId),
          sql`${aiAnalyses.createdAt} > now() - make_interval(hours => ${USAGE_WINDOW_HOURS})`,
        ),
      );
    return {
      runs: row?.runs ?? 0,
      tokens: Number(row?.tokens ?? 0),
      retryAfterSeconds: Number(row?.secondsUntilOldestLeaves ?? 3600),
    };
  }

  async function loadItems(projectId: string, target: AnalysisTarget): Promise<ManuscriptItem[]> {
    const columns = {
      id: documents.id,
      parentId: documents.parentId,
      title: documents.title,
      position: documents.position,
      content: documents.content,
    };
    if (target.scope === "project") {
      return db
        .select(columns)
        .from(documents)
        .where(eq(documents.projectId, projectId))
        .orderBy(asc(documents.position));
    }
    return db
      .select(columns)
      .from(documents)
      .where(
        and(
          eq(documents.projectId, projectId),
          or(
            eq(documents.id, target.documentId ?? ""),
            eq(documents.parentId, target.documentId ?? ""),
          ),
        ),
      )
      .orderBy(asc(documents.position));
  }

  /** Records how a run ended. It only changes a run that is still pending, so a cancel always wins. */
  async function finish(
    id: string,
    outcome:
      | { status: "succeeded"; result: PlotHoleResult; usage: AiUsage }
      | { status: "failed"; errorCode: AnalysisErrorCode; usage?: AiUsage | undefined },
  ): Promise<void> {
    const usage = outcome.usage;
    await db
      .update(aiAnalyses)
      .set({
        status: outcome.status,
        result: outcome.status === "succeeded" ? outcome.result : null,
        errorCode: outcome.status === "failed" ? outcome.errorCode : null,
        ...(usage === undefined
          ? {}
          : { inputTokens: totalInput(usage), outputTokens: usage.outputTokens }),
        completedAt: sql`now()`,
      })
      .where(and(eq(aiAnalyses.id, id), eq(aiAnalyses.status, "pending")));
  }

  async function execute(
    analysisId: string,
    projectId: string,
    target: AnalysisTarget,
    job: Running,
  ): Promise<void> {
    if (client === undefined) return;
    try {
      const items = await loadItems(projectId, target);
      if (items.length === 0) {
        await finish(analysisId, { status: "failed", errorCode: "internal" });
        return;
      }
      const manuscript = buildManuscript(items);
      const outcome = await client.run(
        {
          system: SYSTEM_PROMPT,
          manuscript: `${manuscriptPreface(manuscript)}${manuscript.text}`,
          task: plotHoleTask(target.scope),
          schema: plotHoleOutputSchema,
          model: config.model,
          effort: config.effort,
          maxOutputTokens: config.maxOutputTokens,
        },
        job.controller.signal,
      );

      switch (outcome.kind) {
        case "refused":
          await finish(analysisId, {
            status: "failed",
            errorCode: "refused",
            usage: outcome.usage,
          });
          return;
        case "truncated":
          await finish(analysisId, {
            status: "failed",
            errorCode: "truncated",
            usage: outcome.usage,
          });
          return;
        case "unparseable":
          await finish(analysisId, {
            status: "failed",
            errorCode: "invalid_output",
            usage: outcome.usage,
          });
          return;
        case "ok": {
          const checked = plotHoleOutputSchema.safeParse(outcome.output);
          if (!checked.success) {
            await finish(analysisId, {
              status: "failed",
              errorCode: "invalid_output",
              usage: outcome.usage,
            });
            return;
          }
          await finish(analysisId, {
            status: "succeeded",
            result: verify(checked.data, manuscript),
            usage: outcome.usage,
          });
          return;
        }
      }
    } catch (error) {
      const errorCode: AnalysisErrorCode = job.canceled
        ? "canceled"
        : job.interrupted
          ? "interrupted"
          : job.timedOut
            ? "timeout"
            : codeFor(error);
      if (errorCode === "internal") options.onUnexpectedError?.(describeForLog(error));
      try {
        await finish(analysisId, { status: "failed", errorCode });
      } catch (finishError) {
        options.onUnexpectedError?.(describeForLog(finishError));
      }
    }
  }

  function launch(analysisId: string, projectId: string, target: AnalysisTarget): void {
    const controller = new AbortController();
    const job: Running = {
      controller,
      canceled: false,
      timedOut: false,
      interrupted: false,
      promise: Promise.resolve(),
    };
    const timer = setTimeout(() => {
      job.timedOut = true;
      controller.abort();
    }, config.requestTimeoutMs);
    timer.unref();
    const promise = execute(analysisId, projectId, target, job)
      .catch((error: unknown) => {
        options.onUnexpectedError?.(describeForLog(error));
      })
      .finally(() => {
        clearTimeout(timer);
        running.delete(analysisId);
      });
    running.set(analysisId, Object.assign(job, { promise }));
  }

  async function findRow(userId: string, projectId: string, id: string) {
    const [row] = await db
      .select()
      .from(aiAnalyses)
      .where(
        and(
          eq(aiAnalyses.id, id),
          eq(aiAnalyses.projectId, projectId),
          eq(aiAnalyses.userId, userId),
        ),
      );
    return row;
  }

  async function stop(id: string): Promise<void> {
    const job = running.get(id);
    if (job !== undefined) {
      job.canceled = true;
      job.controller.abort();
    }
    await finish(id, { status: "failed", errorCode: "canceled" });
  }

  return {
    available,

    async estimate(userId, projectId, target) {
      if (!(await ownsProject(userId, projectId))) return undefined;
      const measured = await measure(projectId, target);
      if (measured === undefined) return undefined;
      const estimate = estimateRun(measured.characters, config);
      const used = await usageInWindow(userId);
      return {
        available,
        model: config.model,
        characters: estimate.characters,
        inputTokens: estimate.inputTokens,
        outputTokens: estimate.outputTokens,
        costUsd: estimate.costUsd ?? null,
        fits: estimate.fits,
        maxInputTokens: config.maxInputTokens,
        remaining: {
          runs: Math.max(0, config.userDailyRuns - used.runs),
          tokens: Math.max(0, config.userDailyTokens - used.tokens),
        },
      };
    },

    async start(userId, projectId, target) {
      if (!available) throw new AiUnavailableError();
      if (!(await ownsProject(userId, projectId))) return undefined;
      const measured = await measure(projectId, target);
      if (measured === undefined) return undefined;
      if (!measured.hasText) throw new ManuscriptEmptyError();
      const estimate = estimateRun(measured.characters, config);
      if (!estimate.fits) {
        throw new ManuscriptTooLargeError(estimate.inputTokens.high, config.maxInputTokens);
      }

      const mine = await usageInWindow(userId);
      if (mine.runs >= config.userDailyRuns || mine.tokens >= config.userDailyTokens) {
        throw new DailyLimitError(mine.retryAfterSeconds);
      }
      const everybody = await usageInWindow();
      if (everybody.tokens >= config.globalDailyTokens) throw new GlobalBudgetError();

      let row: AiAnalysis | undefined;
      try {
        [row] = await db
          .insert(aiAnalyses)
          .values({
            userId,
            projectId,
            documentId: target.scope === "document" ? (target.documentId ?? null) : null,
            kind: target.kind,
            scope: target.scope,
            model: config.model,
          })
          .returning();
      } catch (error) {
        if (isUniqueViolation(error, ONE_PENDING_INDEX)) throw new RunInProgressError();
        throw error;
      }
      if (row === undefined) throw new Error("The insert returned no row.");

      launch(row.id, projectId, target);
      return toView(row);
    },

    async get(userId, projectId, id) {
      const row = await findRow(userId, projectId, id);
      return row === undefined ? undefined : toView(row);
    },

    async list(userId, projectId, { limit = DEFAULT_PAGE_SIZE, cursor }) {
      if (!(await ownsProject(userId, projectId))) return undefined;
      const position = cursor === undefined ? undefined : decodeCursor(cursor);
      if (cursor !== undefined && position === undefined) throw new InvalidCursorError();

      const rows = await db
        .select({
          analysis: aiAnalyses,
          // The exact time as the database holds it (microseconds), so no row is skipped or repeated.
          exactCreatedAt: sql<string>`${aiAnalyses.createdAt}::text`,
        })
        .from(aiAnalyses)
        .where(
          and(
            eq(aiAnalyses.projectId, projectId),
            eq(aiAnalyses.userId, userId),
            position === undefined
              ? undefined
              : sql`(${aiAnalyses.createdAt}, ${aiAnalyses.id}) < (${position.updatedAt}::timestamptz, ${position.id}::uuid)`,
          ),
        )
        .orderBy(desc(aiAnalyses.createdAt), desc(aiAnalyses.id))
        .limit(limit + 1);

      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map((row) => toView(row.analysis)),
        // The cursor is the same text-and-id pair the project list uses; here the time is `created_at`.
        nextCursor:
          rows.length > limit && last !== undefined
            ? encodeCursor({ updatedAt: last.exactCreatedAt, id: last.analysis.id })
            : null,
      };
    },

    async cancel(userId, projectId, id) {
      const row = await findRow(userId, projectId, id);
      if (row === undefined) return undefined;
      if (row.status === "pending") await stop(id);
      const after = await findRow(userId, projectId, id);
      return after === undefined ? undefined : toView(after);
    },

    async remove(userId, projectId, id) {
      const row = await findRow(userId, projectId, id);
      if (row === undefined) return false;
      if (row.status === "pending") await stop(id);
      const deleted = await db
        .delete(aiAnalyses)
        .where(and(eq(aiAnalyses.id, id), eq(aiAnalyses.userId, userId)))
        .returning({ id: aiAnalyses.id });
      return deleted.length > 0;
    },

    async sweepInterrupted() {
      const swept = await db
        .update(aiAnalyses)
        .set({ status: "failed", errorCode: "interrupted", completedAt: sql`now()` })
        .where(eq(aiAnalyses.status, "pending"))
        .returning({ id: aiAnalyses.id });
      return swept.length;
    },

    async idle() {
      while (running.size > 0) {
        await Promise.allSettled([...running.values()].map((job) => job.promise));
      }
    },

    async shutdown() {
      for (const job of running.values()) {
        job.interrupted = true;
        job.controller.abort();
      }
      await this.idle();
    },
  };
}
