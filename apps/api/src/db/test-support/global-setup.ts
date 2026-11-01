import { prepareTestDatabase } from "./test-database.ts";

/** Vitest global setup for the integration project: a fresh, fully migrated test database. */
export default async function setup(): Promise<void> {
  await prepareTestDatabase();
}
