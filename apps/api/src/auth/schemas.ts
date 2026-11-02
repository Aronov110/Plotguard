import { z } from "zod";

// These schemas check the shape and put a rough ceiling on sizes. The exact rules (12 to 128
// characters, a valid address, ...) live in the auth service, which explains each problem in words
// that the web forms can show. The ceilings only stop absurd values early.

const MAX_FIELD_UNITS = 1024;

export const registerBodySchema = z.strictObject({
  email: z.string().max(MAX_FIELD_UNITS).describe("The email address. Stored in lowercase."),
  password: z
    .string()
    .max(MAX_FIELD_UNITS)
    .describe("12 to 128 characters. Spaces and any language are allowed."),
  displayName: z
    .string()
    .max(MAX_FIELD_UNITS)
    .nullable()
    .optional()
    .describe("Optional, 1 to 80 characters."),
});

export const loginBodySchema = z.strictObject({
  email: z.string().max(MAX_FIELD_UNITS),
  password: z.string().max(MAX_FIELD_UNITS),
});

export const userSchema = z.object({
  id: z.string().describe("The user's id (a UUID)."),
  email: z.string(),
  displayName: z.string().nullable(),
});

export const sessionResponseSchema = z.object({
  user: userSchema,
  accessToken: z
    .string()
    .describe("Send as `Authorization: Bearer <token>`. Keep it in memory only."),
  expiresIn: z.number().int().describe("Seconds until the access token expires."),
});

export const meResponseSchema = z.object({ user: userSchema });
