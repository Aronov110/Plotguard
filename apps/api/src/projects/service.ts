import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import { type NewProject, type Project, projects } from "../db/schema/projects.ts";
import { decodeCursor, encodeCursor } from "./cursor.ts";
import type { CreateProjectInput, PatchProjectInput, ProjectList, ProjectView } from "./schemas.ts";

/** Thrown by `list` when the cursor is not one this service made. The route answers 400. */
export class InvalidCursorError extends Error {
  constructor() {
    super("The cursor is not valid.");
    this.name = "InvalidCursorError";
  }
}

export interface ListOptions {
  readonly limit: number;
  /** The `nextCursor` of the previous page; leave out for the first page. */
  readonly cursor?: string | undefined;
}

/**
 * Projects of one person. Every method takes the owner's id and puts it in the `WHERE` of every
 * query, so a project of someone else is simply not found. Methods that look one project up return
 * `undefined` for "not found" and for "not yours" alike, so nobody can learn which ids exist.
 */
export interface ProjectsService {
  list(userId: string, options: ListOptions): Promise<ProjectList>;
  create(userId: string, input: CreateProjectInput): Promise<ProjectView>;
  get(userId: string, id: string): Promise<ProjectView | undefined>;
  update(userId: string, id: string, patch: PatchProjectInput): Promise<ProjectView | undefined>;
  /** @returns whether a project was deleted. Its documents and analyses go with it. */
  remove(userId: string, id: string): Promise<boolean>;
}

/** A blank logline is no logline. */
function loglineValue(logline: string | null | undefined): string | null {
  return logline === undefined || logline === null || logline === "" ? null : logline;
}

function toView(row: Project): ProjectView {
  return {
    id: row.id,
    title: row.title,
    format: row.format,
    logline: row.logline,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createProjectsService(db: Database): ProjectsService {
  return {
    async list(userId, { limit, cursor }) {
      const position = cursor === undefined ? undefined : decodeCursor(cursor);
      if (cursor !== undefined && position === undefined) throw new InvalidCursorError();

      const rows = await db
        .select({
          project: projects,
          // The exact time as the database holds it (microseconds). See `ProjectCursor`.
          exactUpdatedAt: sql<string>`${projects.updatedAt}::text`,
        })
        .from(projects)
        .where(
          and(
            eq(projects.userId, userId),
            position === undefined
              ? undefined
              : sql`(${projects.updatedAt}, ${projects.id}) < (${position.updatedAt}::timestamptz, ${position.id}::uuid)`,
          ),
        )
        .orderBy(desc(projects.updatedAt), desc(projects.id))
        // One more than asked for: its presence says there is a next page.
        .limit(limit + 1);

      const page = rows.slice(0, limit);
      const last = page.at(-1);
      const nextCursor =
        rows.length > limit && last !== undefined
          ? encodeCursor({ updatedAt: last.exactUpdatedAt, id: last.project.id })
          : null;
      return { items: page.map((row) => toView(row.project)), nextCursor };
    },

    async create(userId, input) {
      const [row] = await db
        .insert(projects)
        .values({
          userId,
          title: input.title,
          format: input.format,
          logline: loglineValue(input.logline),
        })
        .returning();
      if (row === undefined) throw new Error("The insert returned no row.");
      return toView(row);
    },

    async get(userId, id) {
      const [row] = await db
        .select()
        .from(projects)
        .where(and(eq(projects.id, id), eq(projects.userId, userId)));
      return row === undefined ? undefined : toView(row);
    },

    async update(userId, id, patch) {
      // Only the fields that were sent. `logline: null` is "clear it", a missing key is "leave it".
      const changes: Partial<Pick<NewProject, "title" | "format" | "logline">> = {};
      if (patch.title !== undefined) changes.title = patch.title;
      if (patch.format !== undefined) changes.format = patch.format;
      if (patch.logline !== undefined) changes.logline = loglineValue(patch.logline);

      const [row] = await db
        .update(projects)
        .set(changes)
        .where(and(eq(projects.id, id), eq(projects.userId, userId)))
        .returning();
      return row === undefined ? undefined : toView(row);
    },

    async remove(userId, id) {
      const deleted = await db
        .delete(projects)
        .where(and(eq(projects.id, id), eq(projects.userId, userId)))
        .returning({ id: projects.id });
      return deleted.length > 0;
    },
  };
}
