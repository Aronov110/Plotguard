/** What `parseIfMatch` found in the header. */
export type IfMatch =
  | { readonly kind: "missing" }
  | { readonly kind: "malformed" }
  | { readonly kind: "version"; readonly version: number };

/** A positive whole number that fits the integer column with room to spare. */
const VERSION = /^[1-9][0-9]{0,8}$/;

/** The `ETag` header value for a version: the number in double quotes, for example `"3"`. */
export function formatEtag(version: number): string {
  return `"${version}"`;
}

/**
 * Reads an `If-Match` header. Accepts exactly one entity tag, `"3"` or `W/"3"`. The weak form is
 * accepted on purpose: proxies that compress responses turn strong tags weak, and a browser then
 * sends the weak one back. `*`, lists and anything else are `malformed`, because "save over
 * whatever is there" is exactly what this header exists to prevent.
 */
export function parseIfMatch(header: string | undefined): IfMatch {
  if (header === undefined) return { kind: "missing" };
  const value = header.trim();
  const match = /^(?:W\/)?"([^"]*)"$/.exec(value);
  const digits = match?.[1];
  if (digits === undefined || !VERSION.test(digits)) return { kind: "malformed" };
  return { kind: "version", version: Number(digits) };
}
