import { buildApp } from "./app.ts";
import { loadEnv } from "./config/env.ts";
import { createDatabase } from "./db/client.ts";

const env = loadEnv(process.env);
const app = buildApp(env, { database: createDatabase(env.DATABASE_URL) });

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
