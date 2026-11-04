const MAX_LENGTH = 2048;

/**
 * Decides whether "go back to where you were" is safe, and where exactly that is.
 *
 * After a login the person returns to the page that sent them to the login. That address comes
 * from the browser's history state, so it is checked like any other input: a bad one could send
 * a freshly signed-in person to a look-alike site (an "open redirect").
 *
 * Starting with a single `/` is not enough: browsers read `/\evil.example` and `/<tab>/evil.example`
 * as `//evil.example`. So the address is resolved the way the browser would resolve it, and only
 * accepted when the result is still on this site.
 *
 * @returns the cleaned path, query and fragment (never an origin), or `undefined` if the value
 *   is not a safe address inside the app. `/auth` and everything below it are the API's, not pages.
 */
export function safeReturnPath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > MAX_LENGTH || !value.startsWith("/")) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(value, window.location.origin);
  } catch {
    // Not an address at all.
    return undefined;
  }

  if (url.origin !== window.location.origin) return undefined;

  // `/%61uth` is `/auth` to a server that decodes it, so compare the decoded path too. A path whose
  // percent-encoding is broken is not one the app would ever produce: refuse it.
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return undefined;
  }
  if (isApiPath(url.pathname) || isApiPath(decoded)) return undefined;

  // Dot segments can leave a path that starts with two slashes: `/.//evil.example` becomes
  // `//evil.example`. As a URL it is still on this site, but anything that used it as a plain
  // string address would read it as another site's, so it is refused.
  const path = `${url.pathname}${url.search}${url.hash}`;
  return path.startsWith("//") ? undefined : path;
}

function isApiPath(pathname: string): boolean {
  return pathname === "/auth" || pathname.startsWith("/auth/");
}
