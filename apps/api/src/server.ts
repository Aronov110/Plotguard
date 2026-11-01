import { buildApp } from "./app.ts";
import { loadEnv } from "./config/env.ts";

const env = loadEnv(process.env);
const app = buildApp(env);

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
