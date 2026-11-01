import { sql } from "drizzle-orm";
import { check, pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, primaryKey, updatedAt } from "./columns.ts";

export const users = pgTable(
  "users",
  {
    id: primaryKey(),
    /** Always stored lowercase; the API normalizes before insert and the CHECK enforces it. */
    email: text("email").notNull().unique(),
    /** Full argon2id encoded hash string. Never log or return this column. */
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check("users_email_lowercase", sql`${table.email} = lower(${table.email})`),
    check("users_email_length", sql`char_length(${table.email}) between 3 and 254`),
    check("users_password_hash_not_empty", sql`char_length(${table.passwordHash}) > 0`),
    check(
      "users_display_name_length",
      sql`${table.displayName} is null or char_length(${table.displayName}) between 1 and 80`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
