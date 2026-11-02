const DEFAULT_API_URL = "http://127.0.0.1:3000";

/**
 * Matches `/auth`, `/auth/...` and `/auth?...`, and nothing else. Vite reads a key that starts with
 * `^` as a regular expression; a plain "/auth" key would match by prefix and also forward page
 * addresses such as `/authors` or `/auth-callback` to the API.
 */
export const AUTH_PROXY_KEY = "^/auth(/|\\?|$)";

export interface ProxyRule {
  readonly target: string;
  readonly changeOrigin: boolean;
  readonly ws: boolean;
}

/**
 * Builds the Vite dev-server proxy that forwards `/auth` to the API, so the page and the API share
 * one address. That is required, not a convenience: the login cookies are `SameSite=Strict` and
 * host-only, and the web app can only read the CSRF cookie of its own host.
 *
 * The path is forwarded unchanged (no `/api` prefix) because the refresh cookie is limited to
 * `Path=/auth` in development. `changeOrigin` stays off so the browser's `Origin` header reaches
 * the API untouched; the API checks it against its allowlist.
 *
 * Add one entry here for each new API area (for example `/projects`). The same list becomes the
 * reverse-proxy rule in production.
 *
 * @param apiUrl The `API_URL` setting: scheme, host and port only. Defaults to the local API.
 * @throws Error when the setting is not a plain http(s) address.
 */
export function createApiProxy(apiUrl: string | undefined): Record<string, ProxyRule> {
  const raw = apiUrl ?? DEFAULT_API_URL;

  let url: URL;
  try {
    url = new URL(raw);
  } catch (cause) {
    throw new Error("API_URL is not a valid URL.", { cause });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("API_URL must start with http:// or https://.");
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("API_URL must not contain a user name or password.");
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new Error("API_URL must be only a scheme, host and port, without a path or query.");
  }

  return { [AUTH_PROXY_KEY]: { target: url.origin, changeOrigin: false, ws: false } };
}
