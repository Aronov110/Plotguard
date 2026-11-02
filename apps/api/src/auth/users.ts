import { eq } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import { isUniqueViolation } from "../db/pg-errors.ts";
import { type User, users } from "../db/schema/users.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The email is already used by another account. */
export class EmailTakenError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("That email is already registered.", options);
    this.name = "EmailTakenError";
  }
}

/** What the API may show about a user. The password hash is deliberately not in here. */
export interface PublicUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string | null;
}

export function toPublicUser(user: User): PublicUser {
  return { id: user.id, email: user.email, displayName: user.displayName };
}

/** Exact match on the stored (lowercase) email. The caller normalises first. */
export async function findUserByEmail(db: Database, email: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return user;
}

export async function findUserById(db: Database, id: string): Promise<User | undefined> {
  // A value that is not a UUID can never match, and would make Postgres raise an error instead.
  if (!UUID_PATTERN.test(id)) return undefined;
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user;
}

export interface NewUserInput {
  /** Already normalised: trimmed and lowercase. The database refuses anything else. */
  readonly email: string;
  readonly passwordHash: string;
  readonly displayName: string | null;
}

/** Inserts a user. Throws {@link EmailTakenError} when the email exists, even under a race. */
export async function createUser(db: Database, input: NewUserInput): Promise<User> {
  try {
    const [user] = await db
      .insert(users)
      .values({
        email: input.email,
        passwordHash: input.passwordHash,
        displayName: input.displayName,
      })
      .returning();
    if (user === undefined) throw new Error("The insert returned no row");
    return user;
  } catch (error) {
    if (isUniqueViolation(error, "users_email_unique")) throw new EmailTakenError({ cause: error });
    throw error;
  }
}

export async function updatePasswordHash(
  db: Database,
  userId: string,
  passwordHash: string,
): Promise<void> {
  if (!UUID_PATTERN.test(userId)) return;
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}
