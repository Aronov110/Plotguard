import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, primaryKey, timestamptz } from "./columns.ts";
import { users } from "./users.ts";

/**
 * One row per issued refresh token. Rotation creates a new row in the same family; presenting an
 * already-revoked token means reuse, and the whole family is revoked (see the Step 2 plan).
 */
export const refreshSessions = pgTable(
  "refresh_sessions",
  {
    id: primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    familyId: uuid("family_id").notNull(),
    /** Lowercase hex SHA-256 of the opaque token. The raw token is never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamptz("expires_at").notNull(),
    revokedAt: timestamptz("revoked_at"),
    createdAt: createdAt(),
  },
  (table) => [
    index("refresh_sessions_user_id_idx").on(table.userId),
    index("refresh_sessions_family_id_idx").on(table.familyId),
    index("refresh_sessions_expires_at_idx").on(table.expiresAt),
    check("refresh_sessions_token_hash_format", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("refresh_sessions_expires_after_created", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export type RefreshSession = typeof refreshSessions.$inferSelect;
export type NewRefreshSession = typeof refreshSessions.$inferInsert;
