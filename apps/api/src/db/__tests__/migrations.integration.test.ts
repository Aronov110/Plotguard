import { execFile } from "node:child_process";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseHandle } from "../client.ts";
import { MIGRATIONS_FOLDER, runMigrations } from "../migrate.ts";
import { createScratchDatabase, type ScratchDatabase } from "../test-support/test-database.ts";

const run = promisify(execFile);
const API_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DRIZZLE_KIT_BIN = join(API_ROOT, "node_modules", "drizzle-kit", "bin.cjs");

const EXPECTED_TABLES = ["ai_analyses", "documents", "projects", "refresh_sessions", "users"];

describe("migrations", () => {
  let scratch: ScratchDatabase;
  let handle: DatabaseHandle;

  beforeEach(async () => {
    scratch = await createScratchDatabase();
    handle = createDatabase(scratch.url);
  });

  afterEach(async () => {
    await handle.close();
    await scratch.drop();
  });

  async function appliedMigrationCount(): Promise<number> {
    const { rows } = await handle.pool.query<{ count: string }>(
      "select count(*) from drizzle.__drizzle_migrations",
    );
    return Number(rows[0]?.count);
  }

  it("applies every migration to an empty database and creates all tables", async () => {
    await runMigrations(handle.db);

    const { rows } = await handle.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' order by table_name`,
    );
    expect(rows.map((row) => row.table_name)).toEqual(EXPECTED_TABLES);
  });

  it("records one bookkeeping row per migration file", async () => {
    await runMigrations(handle.db);

    const files = (await readdir(MIGRATIONS_FOLDER)).filter((name) => name.endsWith(".sql"));
    expect(await appliedMigrationCount()).toBe(files.length);
  });

  it("is a no-op when run a second time", async () => {
    await runMigrations(handle.db);
    const before = await appliedMigrationCount();

    await expect(runMigrations(handle.db)).resolves.toBeUndefined();

    expect(await appliedMigrationCount()).toBe(before);
  });

  it("installs the trigger functions and triggers", async () => {
    await runMigrations(handle.db);

    const functions = await handle.pool.query<{ proname: string }>(
      `select proname from pg_proc
       where proname in ('set_updated_at', 'enforce_document_max_depth') order by proname`,
    );
    expect(functions.rows.map((row) => row.proname)).toEqual([
      "enforce_document_max_depth",
      "set_updated_at",
    ]);

    const triggers = await handle.pool.query<{ tgname: string }>(
      "select tgname from pg_trigger where not tgisinternal order by tgname",
    );
    expect(triggers.rows.map((row) => row.tgname)).toEqual([
      "documents_enforce_max_depth",
      "documents_set_updated_at",
      "projects_set_updated_at",
      "users_set_updated_at",
    ]);
  });

  it("fails loudly instead of swallowing the error when a migration cannot apply", async () => {
    // Pre-create a conflicting table so the first migration's CREATE TABLE fails.
    await handle.pool.query('create table "users" (id int)');

    await expect(runMigrations(handle.db)).rejects.toThrow();
  });
});

describe("schema drift", () => {
  it("has no difference between the Drizzle schema and the committed migrations", async () => {
    // Run drizzle-kit against a temporary copy of the migrations folder, so a failure can never
    // leave a stray migration file in the repository.
    const workDir = await mkdtemp(join(tmpdir(), "plotpal-drift-"));
    const outDir = join(workDir, "drizzle");
    try {
      await cp(MIGRATIONS_FOLDER, outDir, { recursive: true });
      const before = (await readdir(outDir)).filter((name) => name.endsWith(".sql")).sort();

      // drizzle-kit joins --out onto the working directory even when it is absolute, which breaks
      // on Windows. Running from the temp directory with a relative --out avoids that. The schema
      // glob needs forward slashes on every platform.
      const schemaGlob = `${API_ROOT.replaceAll("\\", "/")}src/db/schema/*.ts`;
      const { stdout } = await run(
        process.execPath,
        [
          DRIZZLE_KIT_BIN,
          "generate",
          "--dialect=postgresql",
          `--schema=${schemaGlob}`,
          "--out=drizzle",
          "--name=drift_check",
        ],
        { cwd: workDir },
      );

      const after = (await readdir(outDir)).filter((name) => name.endsWith(".sql")).sort();
      expect(after).toEqual(before);
      expect(stdout).toContain("No schema changes");
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }, 60_000);
});
