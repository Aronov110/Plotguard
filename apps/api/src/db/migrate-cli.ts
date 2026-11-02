import { loadDatabaseEnv } from "../config/env.ts";
import { createDatabase } from "./client.ts";
import { runMigrations } from "./migrate.ts";

const env = loadDatabaseEnv(process.env);
const { db, close } = createDatabase(env.DATABASE_URL);

try {
  await runMigrations(db);
  console.log("Migrations applied.");
} catch (error) {
  console.error("Migration failed:", error);
  process.exitCode = 1;
} finally {
  await close();
}
