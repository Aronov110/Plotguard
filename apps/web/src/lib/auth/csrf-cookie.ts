// The API sets this cookie with a different name in production (`__Host-` prefix, see the README).
// Looking for both names means a production build still works against a development API.
const CSRF_COOKIE_NAMES = ["__Host-csrf_token", "csrf_token"] as const;

/**
 * Reads the CSRF code from the page's cookies. The web app copies it into the `X-CSRF-Token`
 * header of requests that change a login (refresh and logout). It is readable on purpose: an
 * attacker's page on another site cannot read it, so it cannot send a matching header.
 *
 * Returns `undefined` when the cookie is missing, empty or not valid percent-encoding. A missing
 * cookie also tells the session code that no one is signed in, so it skips a pointless request.
 */
export function readCsrfToken(cookies: string = document.cookie): string | undefined {
  const jar = new Map<string, string>();
  for (const part of cookies.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    // The first cookie of a name wins, like a browser sending its most specific cookie first.
    if (!jar.has(name)) jar.set(name, part.slice(separator + 1).trim());
  }

  for (const name of CSRF_COOKIE_NAMES) {
    const raw = jar.get(name);
    if (raw === undefined || raw === "") continue;
    try {
      return decodeURIComponent(raw);
    } catch {
      // Broken percent-encoding is not a code the API would have set: treat it as missing.
      return undefined;
    }
  }
  return undefined;
}
