import { randomBytes } from "node:crypto";
import { expect } from "vitest";
import type { Database } from "../client.ts";
import { aiAnalyses, type NewAiAnalysis } from "../schema/ai-analyses.ts";
import { documents, type NewDocument } from "../schema/documents.ts";
import { type NewProject, projects } from "../schema/projects.ts";
import { type NewRefreshSession, refreshSessions } from "../schema/refresh-sessions.ts";
import { type NewUser, users } from "../schema/users.ts";

/** Unique lowercase address for each call, so tests never collide on the unique email. */
export function uniqueEmail(): string {
  return `user-${randomBytes(6).toString("hex")}@example.test`;
}

/** A valid 64-character lowercase hex string, shaped like a SHA-256 digest. */
export function fakeTokenHash(): string {
  return randomBytes(32).toString("hex");
}

export async function insertUser(db: Database, overrides: Partial<NewUser> = {}) {
  const [row] = await db
    .insert(users)
    .values({ email: uniqueEmail(), passwordHash: "$argon2id$test-hash", ...overrides })
    .returning();
  if (!row) throw new Error("insertUser returned no row");
  return row;
}

export async function insertProject(
  db: Database,
  userId: string,
  overrides: Partial<NewProject> = {},
) {
  const [row] = await db
    .insert(projects)
    .values({ userId, title: "The Lighthouse", format: "screenplay", ...overrides })
    .returning();
  if (!row) throw new Error("insertProject returned no row");
  return row;
}

export async function insertDocument(
  db: Database,
  projectId: string,
  overrides: Partial<NewDocument> = {},
) {
  const [row] = await db
    .insert(documents)
    .values({ projectId, title: "Act 1", position: 0, ...overrides })
    .returning();
  if (!row) throw new Error("insertDocument returned no row");
  return row;
}

export async function insertRefreshSession(
  db: Database,
  userId: string,
  overrides: Partial<NewRefreshSession> = {},
) {
  const [row] = await db
    .insert(refreshSessions)
    .values({
      userId,
      familyId: crypto.randomUUID(),
      tokenHash: fakeTokenHash(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("insertRefreshSession returned no row");
  return row;
}

export async function insertAiAnalysis(
  db: Database,
  userId: string,
  projectId: string,
  overrides: Partial<NewAiAnalysis> = {},
) {
  const [row] = await db
    .insert(aiAnalyses)
    .values({
      userId,
      projectId,
      kind: "plot_holes",
      scope: "project",
      model: "claude-test-model",
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("insertAiAnalysis returned no row");
  return row;
}

export interface PgErrorInfo {
  /** SQLSTATE, e.g. "23505" for a unique violation. */
  readonly code: string;
  readonly constraint: string | undefined;
  readonly message: string;
}

/**
 * Reads the PostgreSQL error details from an error thrown by Drizzle/pg, which wraps the driver
 * error in a `cause`. Returns undefined when no error in the chain carries a SQLSTATE code.
 */
export function pgErrorInfo(error: unknown): PgErrorInfo | undefined {
  let current: unknown = error;
  while (current instanceof Error) {
    const { code, constraint } = current as { code?: unknown; constraint?: unknown };
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
      return {
        code,
        constraint: typeof constraint === "string" ? constraint : undefined,
        message: current.message,
      };
    }
    current = current.cause;
  }
  return undefined;
}

export const PG_ERRORS = {
  uniqueViolation: "23505",
  foreignKeyViolation: "23503",
  checkViolation: "23514",
  notNullViolation: "23502",
} as const;

/**
 * Asserts that `statement` fails with the given SQLSTATE and, when given, the named constraint.
 * A statement that succeeds fails the test, so a missing constraint cannot go unnoticed.
 */
export async function expectPgError(
  statement: PromiseLike<unknown>,
  code: string,
  constraint?: string,
): Promise<PgErrorInfo> {
  let failure: unknown;
  try {
    await statement;
  } catch (error) {
    failure = error;
  }
  if (failure === undefined) {
    expect.fail(`Expected PostgreSQL error ${code}, but the statement succeeded`);
  }
  const info = pgErrorInfo(failure);
  if (!info) throw failure;
  expect(info.code).toBe(code);
  if (constraint !== undefined) expect(info.constraint).toBe(constraint);
  return info;
}
