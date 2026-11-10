import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, primaryKey, updatedAt } from "./columns.ts";
import { projects } from "./projects.ts";

/**
 * An outline unit of a project: an act, chapter or scene. Nesting is limited to one level, which
 * the `enforce_document_max_depth` trigger enforces (see drizzle/0001_triggers.sql). The trigger
 * does not lock, so two simultaneous writes to the same outline could in theory race past it.
 */
export const documents = pgTable(
  "documents",
  {
    id: primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    title: text("title").notNull(),
    /** Fountain for screenplays; plain text or Markdown for prose. */
    content: text("content").notNull().default(""),
    position: integer("position").notNull(),
    wordCount: integer("word_count").notNull().default(0),
    /**
     * Counts the changes to this document's own title, text and place. A save must name the version
     * it read (`If-Match`), so a stale save is refused instead of overwriting a newer one.
     */
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("documents_project_id_id_unique").on(table.projectId, table.id),
    // Composite key: the parent must belong to the same project. Not enforced when parent_id is NULL.
    foreignKey({
      name: "documents_parent_same_project_fk",
      columns: [table.projectId, table.parentId],
      foreignColumns: [table.projectId, table.id],
    }).onDelete("cascade"),
    index("documents_project_parent_position_idx").on(
      table.projectId,
      table.parentId,
      table.position,
    ),
    check("documents_title_length", sql`char_length(${table.title}) between 1 and 200`),
    check("documents_position_non_negative", sql`${table.position} >= 0`),
    check("documents_word_count_non_negative", sql`${table.wordCount} >= 0`),
    check("documents_version_positive", sql`${table.version} >= 1`),
    check("documents_not_own_parent", sql`${table.parentId} is distinct from ${table.id}`),
  ],
);

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
