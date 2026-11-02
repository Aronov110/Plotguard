import type { Writable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.ts";
import { type Env, loadEnv } from "../config/env.ts";
import { createDatabase } from "../db/client.ts";

const BASE_ENV: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://user:pass@127.0.0.1:5432/db",
  JWT_ACCESS_SECRET: "test-only-secret-never-use-outside-tests-0123456789",
};

/** Builds a validated test environment. Extra variables override the defaults. */
export function testEnv(overrides: Readonly<Record<string, string>> = {}): Env {
  return loadEnv({ ...BASE_ENV, ...overrides });
}

export interface TestAppOptions {
  readonly env?: Readonly<Record<string, string>>;
  /** Registers extra routes before the app starts, for example routes that throw on purpose. */
  readonly routes?: (app: FastifyInstance) => void | Promise<void>;
  /** Captures log output. Without it the logger is silent in the test environment. */
  readonly logStream?: Writable;
}

/**
 * Builds the real app for unit tests. The database pool is lazy, so nothing connects
 * unless a route actually runs a query. `app.close()` ends the pool.
 */
export function buildTestApp(options: TestAppOptions = {}): FastifyInstance {
  const env = testEnv(options.env);
  const database = createDatabase(env.DATABASE_URL);
  const app = buildApp(env, {
    database,
    ...(options.logStream === undefined ? {} : { logStream: options.logStream }),
  });
  if (options.routes !== undefined) {
    app.register(async (scope) => {
      await options.routes?.(scope);
    });
  }
  return app;
}
