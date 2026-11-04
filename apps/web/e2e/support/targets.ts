/**
 * Where the end-to-end servers listen. They are `127.0.0.1`, never `localhost`: the API's origin
 * allowlist and the cookies belong to that exact host.
 *
 * Keep both in line with `E2E_WEB_ORIGIN` and `E2E_API_PORT` in
 * apps/api/src/test-support/e2e-config.ts; the API refuses calls from any other web address.
 */

/** The web app: the production build served by `vite preview`, which also proxies `/auth`. */
export const WEB_ORIGIN = "http://127.0.0.1:4173";

/** The end-to-end API, reachable directly (without the proxy) for set-up and control calls. */
export const API_ORIGIN = "http://127.0.0.1:3100";
