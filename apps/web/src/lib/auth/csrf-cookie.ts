/**
 * The name of the CSRF cookie for a build. The API names its cookies after its own environment:
 * `__Host-csrf_token` in production, `csrf_token` otherwise (see the README). A production build
 * reads only the `__Host-` name, because browsers refuse to let another host (say, a sibling
 * subdomain an attacker controls) set a `__Host-` cookie, but they do let it set a plain one.
 * Accepting a plain name in production would let such a host plant a junk code.
 */
export function csrfCookieNames(production: boolean): readonly string[] {
  return production ? ["__Host-csrf_token"] : ["csrf_token"];
}

const BUILD_COOKIE_NAMES = csrfCookieNames(import.meta.env.PROD);

/**
 * Reads the CSRF code from the page's cookies. The web app copies it into the `X-CSRF-Token`
 * header of requests that change a login (refresh and logout). It is readable on purpose: an
 * attacker's page on another site cannot read it, so it cannot send a matching header.
 *
 * Returns `undefined` when the cookie is missing, empty or not valid percent-encoding. A missing
 * cookie also tells the session code that no one is signed in, so it skips a pointless request.
 *
 * @param names Which cookie names count. Defaults to the names for the current build.
 */
export function readCsrfToken(
  cookies: string = document.cookie,
  names: readonly string[] = BUILD_COOKIE_NAMES,
): string | undefined {
  const jar = new Map<string, string>();
  for (const part of cookies.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    // The first cookie of a name wins, like a browser sending its most specific cookie first.
    if (!jar.has(name)) jar.set(name, part.slice(separator + 1).trim());
  }

  for (const name of names) {
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
