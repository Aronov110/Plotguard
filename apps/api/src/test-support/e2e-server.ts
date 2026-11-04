import { buildApp } from "../app.ts";
import { createDatabase } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { loadTestEnv, recreateDatabase } from "../db/test-support/test-database.ts";
import { buildE2eSettings } from "./e2e-config.ts";
import { createReplyHold } from "./e2e-reply-hold.ts";

/**
 * Starts the API for the end-to-end browser tests (see apps/web/playwright.config.ts): a fresh,
 * fully migrated throwaway database, relaxed per-address limits, loopback only. All rules live in
 * {@link buildE2eSettings}; this file only wires them up.
 *
 * It also has two test-only routes, under `/__e2e`, that exist nowhere else: a test arms them to
 * hold back the reply to the next logout (the logout itself still happens at once) and releases it
 * later, which reproduces a slow network without touching the request.
 */
loadTestEnv();
const { env, databaseUrl, authLimits } = buildE2eSettings(process.env);

await recreateDatabase(new URL(databaseUrl));
const database = createDatabase(databaseUrl);
await runMigrations(database.db);

const app = buildApp(env, { database, authLimits });

const logoutReplyHold = createReplyHold();

// `onSend` runs after the route has finished and has set its cookies, and before the reply goes out.
app.addHook("onSend", async (request, _reply, payload) => {
  if (request.method === "POST" && request.routeOptions.url === "/auth/logout") {
    await logoutReplyHold.waitIfArmed();
  }
  return payload;
});

app.post("/__e2e/hold-next-logout-reply", async (_request, reply) => {
  logoutReplyHold.arm();
  return reply.code(204).send();
});

app.post("/__e2e/release-logout-reply", async (_request, reply) => {
  logoutReplyHold.release();
  return reply.code(204).send();
});

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
