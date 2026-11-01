import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createDatabase, type DatabaseHandle } from "../client.ts";
import { runMigrations } from "../migrate.ts";
import {
  adminUrlFor,
  assertTestDatabaseUrl,
  databaseName,
  urlForDatabase,
} from "./assert-test-database.ts";

const ROOT_ENV_FILE = fileURLToPath(new URL("../../../../../.env", import.meta.url));

/** Loads the repo-root `.env` into `process.env` without overriding variables already set. */
export function loadTestEnv(): void {
  if (existsSync(ROOT_ENV_FILE)) {
    process.loadEnvFile(ROOT_ENV_FILE);
  }
}

/** The guarded URL of the shared integration-test database. */
export function getTestDatabaseUrl(): URL {
  loadTestEnv();
  return assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
}

async function withAdminClient<T>(url: URL, run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: adminUrlFor(url) });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** Drops (if present) and recreates an empty database. The name has already passed the guard. */
export async function recreateDatabase(url: URL): Promise<void> {
  const name = databaseName(url);
  await withAdminClient(url, async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${name}"`);
  });
}

/** Recreates the shared test database and applies all migrations to it. */
export async function prepareTestDatabase(): Promise<void> {
  const url = getTestDatabaseUrl();
  await recreateDatabase(url);
  const handle = createDatabase(url.toString());
  try {
    await runMigrations(handle.db);
  } finally {
    await handle.close();
  }
}

export interface ScratchDatabase {
  readonly url: string;
  readonly drop: () => Promise<void>;
}

/** Creates an empty, uniquely named `*_test` database, for tests that exercise migrations. */
export async function createScratchDatabase(): Promise<ScratchDatabase> {
  const base = getTestDatabaseUrl();
  const name = `scratch_${randomBytes(6).toString("hex")}_test`;
  const url = urlForDatabase(base, name);
  await recreateDatabase(new URL(url));
  return {
    url,
    drop: () =>
      withAdminClient(base, async (client) => {
        await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      }),
  };
}

/** Connects to the shared test database. Tables are emptied with {@link resetTables}. */
export function connectTestDatabase(): DatabaseHandle {
  return createDatabase(getTestDatabaseUrl().toString());
}

/**
 * Removes every row from every table in the `public` schema, discovering the tables from the
 * database itself so a table added later cannot be forgotten. Migration bookkeeping lives in the
 * separate `drizzle` schema and is left alone.
 */
export async function resetTables(handle: DatabaseHandle): Promise<void> {
  const { rows } = await handle.pool.query<{ qualified_name: string }>(
    `select format('%I.%I', schemaname, tablename) as qualified_name
     from pg_tables where schemaname = 'public' order by tablename`,
  );
  if (rows.length === 0) return;
  await handle.pool.query(`TRUNCATE ${rows.map((row) => row.qualified_name).join(", ")} CASCADE`);
}
