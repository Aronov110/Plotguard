import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../client.ts";
import { insertUser } from "../test-support/factories.ts";
import { connectTestDatabase, resetTables } from "../test-support/test-database.ts";

describe("UUIDv7 primary keys", () => {
  let handle: DatabaseHandle;

  beforeAll(() => {
    handle = connectTestDatabase();
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await resetTables(handle);
  });

  it("generates ids with version nibble 7 and the RFC 9562 variant", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) ids.push((await insertUser(handle.db)).id);

    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it("generates ids that sort in insertion order", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) ids.push((await insertUser(handle.db)).id);

    expect([...ids].sort()).toEqual(ids);
  });

  it("embeds the current time in the first 48 bits", async () => {
    const before = Date.now();
    const { id } = await insertUser(handle.db);
    const after = Date.now();

    const embedded = Number.parseInt(id.replace(/-/g, "").slice(0, 12), 16);
    // The database clock and the test clock run on one machine; allow a small skew.
    expect(embedded).toBeGreaterThanOrEqual(before - 2_000);
    expect(embedded).toBeLessThanOrEqual(after + 2_000);
  });

  it("generates unique ids", async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 30; i++) ids.add((await insertUser(handle.db)).id);

    expect(ids.size).toBe(30);
  });
});
