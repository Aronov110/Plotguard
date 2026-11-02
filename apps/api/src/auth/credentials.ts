import { z } from "zod";

export const EMAIL_MAX_LENGTH = 254;
export const DISPLAY_NAME_MAX_LENGTH = 80;

const MAX_LOCAL_PART_LENGTH = 64;
const MAX_DOMAIN_LABEL_LENGTH = 63;
/** Printable ASCII only, no spaces. See {@link checkEmail} for why. */
const ASCII_PRINTABLE = /^[\x21-\x7E]+$/;
const emailSchema = z.email();

/** Trims and lowercases. Emails are stored lowercase, and the database checks that. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * True for an email that is safe to store. Expects the output of {@link normalizeEmail}.
 *
 * Only printable ASCII is accepted. JavaScript and Postgres lower-case some characters differently
 * (for example the Turkish dotted capital I), so a non-ASCII address could pass here and then break
 * the database's "stored lowercase" check, or look identical to a different address. International
 * addresses can be allowed later, once there is a way to normalise them the same way in both places.
 */
export function checkEmail(email: string): boolean {
  if (email.length < 3 || email.length > EMAIL_MAX_LENGTH) return false;
  if (!ASCII_PRINTABLE.test(email)) return false;
  if (!emailSchema.safeParse(email).success) return false;

  const at = email.lastIndexOf("@");
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > MAX_LOCAL_PART_LENGTH) return false;
  return domain.split(".").every((label) => label.length <= MAX_DOMAIN_LABEL_LENGTH);
}

/** Trims and composes accents (NFC), so "René" typed two ways is stored one way. */
export function normalizeDisplayName(raw: string): string {
  return raw.trim().normalize("NFC");
}

export type DisplayNameIssue = "too-short" | "too-long" | "control-character" | "malformed-unicode";

/** Returns the first problem with a display name, or `undefined`. Judges the trimmed name. */
export function checkDisplayName(raw: string): DisplayNameIssue | undefined {
  if (!raw.isWellFormed()) return "malformed-unicode";
  const name = normalizeDisplayName(raw);
  if (/\p{Cc}/u.test(name)) return "control-character";
  const length = [...name].length;
  if (length < 1) return "too-short";
  if (length > DISPLAY_NAME_MAX_LENGTH) return "too-long";
  return undefined;
}
