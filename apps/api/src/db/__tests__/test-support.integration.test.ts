import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, type DatabaseHandle } from "../client.ts";
import { runMigrations } from "../migrate.ts";
import { insertProject, insertUser } from "../test-support/factories.ts";
import {
  connectTestDatabase,
  createScratchDatabase,
  getTestDatabaseUrl,
  resetTables,
} from "../test-support/test-database.ts";

describe("pool error handling (real server-side disconnect)", () => {
  let handle: DatabaseHandle;
  const onPoolError = vi.fn();

  beforeAll(async () => {
    const url = getTestDatabaseUrl().toString();
    handle = createDatabase(url, { onPoolError });
    await handle.pool.query("select 1"); // open one idle pooled connection
  });
  afterAll(async () => {
    await handle.close();
  });

  it("reports a terminated idle connection to the handler and recovers on the next query", async () => {
    const pidResult = await handle.pool.query<{ pid: number }>("select pg_backend_pid() as pid");
    const pooledPid = pidResult.rows[0]?.pid;
    expect(pooledPid).toBeTypeOf("number");

    const admin = connectTestDatabase();
    try {
      // Kill the pool's idle backend from the server side, as a database restart would.
      const killed = await admin.pool.query<{ terminated: boolean }>(
        "select pg_terminate_backend($1) as terminated",
        [pooledPid],
      );
      expect(killed.rows[0]?.terminated).toBe(true);
    } finally {
      await admin.close();
    }

    // Without an error listener this event would be an unhandled error and crash the worker.
    await vi.waitFor(() => expect(onPoolError).toHaveBeenCalled(), { timeout: 5_000 });
    expect(onPoolError.mock.calls[0]?.[0]).toBeInstanceOf(Error);

    // The pool dropped the dead client and opens a fresh one for the next query.
    const { rows } = await handle.pool.query<{ ok: number; pid: number }>(
      "select 1 as ok, pg_backend_pid() as pid",
    );
    expect(rows[0]?.ok).toBe(1);
    expect(rows[0]?.pid).not.toBe(pooledPid);
  });
});

describe("resetTables", () => {
  it("empties tables that were added after the helper was written, and keeps migration history", async () => {
    const scratch = await createScratchDatabase();
    const scratchHandle = createDatabase(scratch.url);
    try {
      await runMigrations(scratchHandle.db);
      await scratchHandle.pool.query('create table "future_feature" (id int primary key)');
      await scratchHandle.pool.query("insert into future_feature values (1), (2)");
      const user = await insertUser(scratchHandle.db);
      await insertProject(scratchHandle.db, user.id);

      await resetTables(scratchHandle);

      const counts = await scratchHandle.pool.query<{ table: string; rows: string }>(
        `select 'future_feature' as "table", count(*) as rows from future_feature
         union all select 'users', count(*) from users
         union all select 'projects', count(*) from projects`,
      );
      expect(counts.rows.map((row) => Number(row.rows))).toEqual([0, 0, 0]);

      const history = await scratchHandle.pool.query<{ count: string }>(
        "select count(*) from drizzle.__drizzle_migrations",
      );
      expect(Number(history.rows[0]?.count)).toBe(2);
    } finally {
      await scratchHandle.close();
      await scratch.drop();
    }
  });

  it("is safe to call on a database with no tables", async () => {
    const scratch = await createScratchDatabase();
    const scratchHandle = createDatabase(scratch.url);
    try {
      await expect(resetTables(scratchHandle)).resolves.toBeUndefined();
    } finally {
      await scratchHandle.close();
      await scratch.drop();
    }
  });
});
