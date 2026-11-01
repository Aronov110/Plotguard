import { sql } from "drizzle-orm";
import { check, index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, primaryKey, updatedAt } from "./columns.ts";
import { users } from "./users.ts";

export const PROJECT_FORMATS = ["screenplay", "prose", "other"] as const;
export type ProjectFormat = (typeof PROJECT_FORMATS)[number];

export const projects = pgTable(
  "projects",
  {
    id: primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    format: text("format").$type<ProjectFormat>().notNull(),
    logline: text("logline"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // Lets child tables reference (id, user_id) so a row can never point at another user's project.
    unique("projects_id_user_id_unique").on(table.id, table.userId),
    // Serves cursor pagination: newest first, with id as the tie-breaker. `nullsFirst()` matches
    // the default of `ORDER BY ... DESC`; without it the planner adds a separate Sort step.
    index("projects_user_updated_idx").on(
      table.userId,
      table.updatedAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    check("projects_title_length", sql`char_length(${table.title}) between 1 and 200`),
    check("projects_format_valid", sql`${table.format} in ('screenplay', 'prose', 'other')`),
    check(
      "projects_logline_length",
      sql`${table.logline} is null or char_length(${table.logline}) <= 1000`,
    ),
  ],
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
