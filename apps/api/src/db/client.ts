import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { aiAnalyses } from "./schema/ai-analyses.ts";
import { documents } from "./schema/documents.ts";
import { projects } from "./schema/projects.ts";
import { refreshSessions } from "./schema/refresh-sessions.ts";
import { users } from "./schema/users.ts";

export const schema = { users, refreshSessions, projects, documents, aiAnalyses };

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  readonly db: Database;
  readonly pool: pg.Pool;
  /** Closes every pooled connection. Call once on shutdown. */
  readonly close: () => Promise<void>;
}

export interface CreateDatabaseOptions {
  /**
   * Called when an idle pooled connection fails, for example because the database restarted.
   * Defaults to logging the message (never the connection string, which contains the password).
   */
  readonly onPoolError?: (error: Error) => void;
}

function logPoolError(error: Error): void {
  console.error("Unexpected error on an idle database connection:", error.message);
}

/**
 * Creates a connection pool and a Drizzle instance. The session time zone is forced to UTC so
 * `timestamptz` values behave identically on every machine.
 *
 * The pool always has an `error` listener: `pg` emits `error` when an idle client breaks, and an
 * unhandled `error` event would crash the whole process. The pool discards the broken client and
 * opens a new one on the next query.
 */
export function createDatabase(
  databaseUrl: string,
  options: CreateDatabaseOptions = {},
): DatabaseHandle {
  const pool = new pg.Pool({ connectionString: databaseUrl, options: "-c timezone=UTC" });
  pool.on("error", options.onPoolError ?? logPoolError);
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
