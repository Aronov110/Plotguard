import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Database } from "./client.ts";

/** Absolute path of the folder holding the generated SQL migrations. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

/**
 * Applies every pending migration in order, inside Drizzle's own bookkeeping.
 * Errors propagate to the caller; a failed migration is never swallowed.
 */
export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
