import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, primaryKey, timestamptz } from "./columns.ts";
import { documents } from "./documents.ts";
import { projects } from "./projects.ts";
import { users } from "./users.ts";

export const AI_ANALYSIS_KINDS = ["plot_holes", "ideas"] as const;
export const AI_ANALYSIS_SCOPES = ["document", "project"] as const;
export const AI_ANALYSIS_STATUSES = ["pending", "succeeded", "failed"] as const;

export type AiAnalysisKind = (typeof AI_ANALYSIS_KINDS)[number];
export type AiAnalysisScope = (typeof AI_ANALYSIS_SCOPES)[number];
export type AiAnalysisStatus = (typeof AI_ANALYSIS_STATUSES)[number];

/**
 * One AI run (plot-hole scan or idea request). Token counts feed per-user usage limits.
 * `result` holds the model output; its shape is validated by Zod in the application layer.
 */
export const aiAnalyses = pgTable(
  "ai_analyses",
  {
    id: primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    /** Set to NULL when the analysed document is deleted; the analysis itself is kept. */
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    kind: text("kind").$type<AiAnalysisKind>().notNull(),
    scope: text("scope").$type<AiAnalysisScope>().notNull(),
    status: text("status").$type<AiAnalysisStatus>().notNull().default("pending"),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    result: jsonb("result"),
    errorCode: text("error_code"),
    createdAt: createdAt(),
    completedAt: timestamptz("completed_at"),
  },
  (table) => [
    // The project must belong to the same user as the analysis.
    foreignKey({
      name: "ai_analyses_project_owner_fk",
      columns: [table.projectId, table.userId],
      foreignColumns: [projects.id, projects.userId],
    }).onDelete("cascade"),
    // Without this, every document delete scans the table to null out `document_id`.
    index("ai_analyses_document_id_idx").on(table.documentId),
    // `nullsFirst()` matches the default of `ORDER BY ... DESC`, so no extra Sort step is needed.
    index("ai_analyses_user_created_idx").on(table.userId, table.createdAt.desc().nullsFirst()),
    index("ai_analyses_project_created_idx").on(
      table.projectId,
      table.createdAt.desc().nullsFirst(),
    ),
    check("ai_analyses_kind_valid", sql`${table.kind} in ('plot_holes', 'ideas')`),
    check("ai_analyses_scope_valid", sql`${table.scope} in ('document', 'project')`),
    check("ai_analyses_status_valid", sql`${table.status} in ('pending', 'succeeded', 'failed')`),
    check("ai_analyses_model_not_empty", sql`char_length(${table.model}) > 0`),
    check("ai_analyses_input_tokens_non_negative", sql`${table.inputTokens} >= 0`),
    check("ai_analyses_output_tokens_non_negative", sql`${table.outputTokens} >= 0`),
  ],
);

export type AiAnalysis = typeof aiAnalyses.$inferSelect;
export type NewAiAnalysis = typeof aiAnalyses.$inferInsert;
