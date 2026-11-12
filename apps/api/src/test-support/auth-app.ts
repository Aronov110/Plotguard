import argon2 from "argon2";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import type { AiClient } from "../ai/client.ts";
import type { AiConfig } from "../ai/limits.ts";
import { buildApp } from "../app.ts";
import type { AuthLimits } from "../auth/limits.ts";
import { createPasswordHasher } from "../auth/password.ts";
import type { DatabaseHandle } from "../db/client.ts";
import { connectTestDatabase, resetTables } from "../db/test-support/test-database.ts";
import type { DocumentLimits } from "../documents/limits.ts";
import type { ProjectLimits } from "../projects/limits.ts";
import { LogCollector } from "./log-collector.ts";
import { testEnv } from "./test-app.ts";

/** A browser origin that the default test environment allows. */
export const ORIGIN = "http://localhost:5173";
export const PASSWORD = "correct horse battery staple";

const CHEAP = { type: argon2.argon2id, memoryCost: 8, timeCost: 1, parallelism: 1 } as const;
const GENEROUS = { max: 100_000, windowSeconds: 60 } as const;

/** Limits high enough to stay out of the way. Tests about limits pass their own. */
export const NO_LIMITS: AuthLimits = {
  register: GENEROUS,
  login: GENEROUS,
  loginFailuresPerEmailAndIp: GENEROUS,
  loginFailuresPerEmail: GENEROUS,
  refresh: GENEROUS,
  logout: GENEROUS,
};

export interface AuthTestApp {
  readonly app: FastifyInstance;
  readonly handle: DatabaseHandle;
  readonly logs: LogCollector;
  close(): Promise<void>;
}

export interface AuthTestOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly limits?: Partial<AuthLimits>;
  readonly projectLimits?: ProjectLimits;
  readonly documentLimits?: DocumentLimits;
  /** How long a document change waits for the project lock. Short, so a test need not wait. */
  readonly documentLockTimeoutMs?: number;
  /** The model call: a fake. Without one the AI features are off (no key in the test environment). */
  readonly aiClient?: AiClient;
  readonly aiConfig?: AiConfig;
  /** Fails the runs left `pending`, as the real server does when it starts. */
  readonly aiSweepOnStart?: boolean;
}

/**
 * The real app on the real test database, with cheap password hashing so the suite stays fast.
 * Tables are emptied first. `close()` also ends the database pool.
 */
export async function buildAuthTestApp(options: AuthTestOptions = {}): Promise<AuthTestApp> {
  const handle = connectTestDatabase();
  await resetTables(handle);
  const logs = new LogCollector();
  const env = testEnv({ RATE_LIMIT_MAX: "100000", ...options.env });
  const app = buildApp(env, {
    database: handle,
    logStream: logs,
    passwordHasher: createPasswordHasher({ params: CHEAP }),
    authLimits: { ...NO_LIMITS, ...options.limits },
    ...(options.projectLimits === undefined ? {} : { projectLimits: options.projectLimits }),
    ...(options.documentLimits === undefined ? {} : { documentLimits: options.documentLimits }),
    ...(options.aiClient === undefined ? {} : { aiClient: options.aiClient }),
    ...(options.aiConfig === undefined ? {} : { aiConfig: options.aiConfig }),
    ...(options.aiSweepOnStart === undefined ? {} : { aiSweepOnStart: options.aiSweepOnStart }),
    ...(options.documentLockTimeoutMs === undefined
      ? {}
      : { documentLockTimeoutMs: options.documentLockTimeoutMs }),
  });
  await app.ready();
  return { app, handle, logs, close: () => app.close() };
}

export interface ParsedCookie {
  readonly name: string;
  readonly value: string;
  /** Attribute names are lower-cased. Flags such as HttpOnly have the value `true`. */
  readonly attributes: Readonly<Record<string, string | true>>;
}

export function parseSetCookie(header: string): ParsedCookie {
  const [pair = "", ...rest] = header.split(";").map((part) => part.trim());
  const eq = pair.indexOf("=");
  const attributes: Record<string, string | true> = {};
  for (const part of rest) {
    const at = part.indexOf("=");
    if (at === -1) attributes[part.toLowerCase()] = true;
    else attributes[part.slice(0, at).toLowerCase()] = part.slice(at + 1);
  }
  return { name: pair.slice(0, eq), value: pair.slice(eq + 1), attributes };
}

export function setCookies(response: LightMyRequestResponse): ParsedCookie[] {
  const raw = response.headers["set-cookie"];
  if (raw === undefined) return [];
  return (Array.isArray(raw) ? raw : [raw]).map(parseSetCookie);
}

export function findCookie(
  response: LightMyRequestResponse,
  name: string,
): ParsedCookie | undefined {
  return setCookies(response).find((cookie) => cookie.name === name);
}

/** A tiny stand-in for a browser: remembers cookies, drops the ones that are told to expire. */
export class CookieJar {
  readonly #cookies = new Map<string, string>();

  update(response: LightMyRequestResponse): void {
    for (const cookie of setCookies(response)) {
      const expired = cookie.attributes["max-age"] === "0" || cookie.value === "";
      if (expired) this.#cookies.delete(cookie.name);
      else this.#cookies.set(cookie.name, cookie.value);
    }
  }

  get(name: string): string | undefined {
    return this.#cookies.get(name);
  }

  set(name: string, value: string): void {
    this.#cookies.set(name, value);
  }

  /** The value for a `Cookie` request header. */
  get header(): string {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

/** The CSRF code from the jar, under the plain name (development) or the __Host- name (production). */
export function csrfOf(jar: CookieJar): string {
  return jar.get("csrf_token") ?? jar.get("__Host-csrf_token") ?? "";
}

export interface SessionJson {
  user: { id: string; email: string; displayName: string | null };
  accessToken: string;
  expiresIn: number;
}

/** Signs a user up and returns the response, the parsed body and a jar holding the cookies. */
export async function signUp(
  app: FastifyInstance,
  overrides: { email?: string; password?: string; displayName?: string | null } = {},
) {
  const response = await app.inject({
    method: "POST",
    url: "/auth/register",
    headers: { origin: ORIGIN },
    payload: {
      email: overrides.email ?? "mara@example.com",
      password: overrides.password ?? PASSWORD,
      displayName: overrides.displayName === undefined ? "Mara" : overrides.displayName,
    },
  });
  const jar = new CookieJar();
  jar.update(response);
  return { response, jar, body: response.json<SessionJson>() };
}

export function logIn(app: FastifyInstance, email = "mara@example.com", password = PASSWORD) {
  return app.inject({
    method: "POST",
    url: "/auth/login",
    headers: { origin: ORIGIN },
    payload: { email, password },
  });
}

/** POST /auth/refresh the way the web app will: cookies plus the CSRF header plus the Origin. */
export function refresh(
  app: FastifyInstance,
  jar: CookieJar,
  overrides: Record<string, string> = {},
) {
  return app.inject({
    method: "POST",
    url: "/auth/refresh",
    headers: {
      origin: ORIGIN,
      cookie: jar.header,
      "x-csrf-token": csrfOf(jar),
      ...overrides,
    },
  });
}

export function logOut(
  app: FastifyInstance,
  jar: CookieJar,
  overrides: Record<string, string> = {},
) {
  return app.inject({
    method: "POST",
    url: "/auth/logout",
    headers: {
      origin: ORIGIN,
      cookie: jar.header,
      "x-csrf-token": csrfOf(jar),
      ...overrides,
    },
  });
}
