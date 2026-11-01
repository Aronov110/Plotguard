import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../client.ts";
import { connectTestDatabase } from "../test-support/test-database.ts";

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  column_default: string | null;
  is_nullable: "YES" | "NO";
}

const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

describe("schema conventions", () => {
  let handle: DatabaseHandle;
  let columns: ColumnRow[];
  let tables: string[];

  beforeAll(async () => {
    handle = connectTestDatabase();
    const result = await handle.pool.query<ColumnRow>(
      `select table_name, column_name, data_type, column_default, is_nullable
       from information_schema.columns where table_schema = 'public'
       order by table_name, ordinal_position`,
    );
    columns = result.rows;
    tables = [...new Set(columns.map((column) => column.table_name))];
  });
  afterAll(async () => {
    await handle.close();
  });

  it("has the five expected tables", () => {
    expect(tables).toEqual(["ai_analyses", "documents", "projects", "refresh_sessions", "users"]);
  });

  it("uses snake_case for every table and column name", () => {
    for (const table of tables) expect(table, `table ${table}`).toMatch(SNAKE_CASE);
    for (const column of columns) {
      expect(column.column_name, `${column.table_name}.${column.column_name}`).toMatch(SNAKE_CASE);
    }
  });

  it("gives every table a uuid primary key defaulting to uuidv7()", () => {
    for (const table of tables) {
      const id = columns.find((c) => c.table_name === table && c.column_name === "id");
      expect(id, `${table}.id`).toBeDefined();
      expect(id?.data_type).toBe("uuid");
      expect(id?.column_default).toContain("uuidv7()");
    }
  });

  it("stores every *_at column as timestamptz", () => {
    const timestampColumns = columns.filter((c) => c.column_name.endsWith("_at"));
    expect(timestampColumns.length).toBeGreaterThan(0);
    for (const column of timestampColumns) {
      expect(column.data_type, `${column.table_name}.${column.column_name}`).toBe(
        "timestamp with time zone",
      );
    }
  });

  it("never uses a timestamp without time zone anywhere", () => {
    expect(columns.filter((c) => c.data_type === "timestamp without time zone")).toEqual([]);
  });

  it("gives created_at a default and makes it required on every table that has it", () => {
    for (const column of columns.filter((c) => c.column_name === "created_at")) {
      expect(column.is_nullable, `${column.table_name}.created_at`).toBe("NO");
      expect(column.column_default, `${column.table_name}.created_at`).toContain("now()");
    }
  });

  it("gives every table with updated_at a trigger to maintain it", async () => {
    const withUpdatedAt = columns
      .filter((c) => c.column_name === "updated_at")
      .map((c) => c.table_name)
      .sort();
    const { rows } = await handle.pool.query<{ table_name: string }>(
      `select c.relname as table_name
       from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where not t.tgisinternal and t.tgname like '%set_updated_at'`,
    );

    expect(rows.map((row) => row.table_name).sort()).toEqual(withUpdatedAt);
  });

  it("indexes every foreign-key column that is not already the leading column of an index", async () => {
    const { rows } = await handle.pool.query<{ table_name: string; column_name: string }>(
      `select distinct c.relname as table_name, a.attname as column_name
       from pg_constraint con
       join pg_class c on c.oid = con.conrelid
       join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
       where con.contype = 'f' and c.relnamespace = 'public'::regnamespace
         and not exists (
           select 1 from pg_index i
           where i.indrelid = con.conrelid and i.indkey[0] = con.conkey[1]
         )
       order by 1, 2`,
    );

    expect(rows).toEqual([]);
  });
});
