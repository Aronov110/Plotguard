Status: approved (2026-11-02). All recommended options accepted, two-PR split accepted, new
dependencies accepted, Storybook goes into its own small PR before Step 4.

# Step 3: Auth frontend

Sign-up, login, logout and staying signed in, on top of the auth API from Step 2.

## Decisions

- **Router:** React Router, library mode (browser router only).
- **Forms:** plain React and native HTML. The server's messages are the rule book; the page checks
  only that a field is not empty.
- **API shapes:** hand-written Zod schemas for the five auth routes, checked at runtime.
- **Dev proxy:** Vite forwards `/auth` unchanged to the API (`API_URL`, default
  `http://127.0.0.1:3000`). No `changeOrigin`, so `Origin` stays `http://127.0.0.1:5173`, which is
  already in `CORS_ORIGINS`. Page routes use other names (`/login`, `/register`, `/app`).
- **Styling:** plain CSS reading the design tokens (the repo's precedent). No UI library.
- **Tests:** Vitest, Testing Library, MSW (fakes the API on the network level), axe, Playwright.
- **PR 1** `feat/web-auth-foundation`: plumbing (`lib/`), proxy, README. No visible change.
- **PR 2** `feat/web-auth-screens`: components, pages, routing, Playwright end-to-end tests.
- **Storybook:** its own small PR before Step 4.

## PR 1: plumbing

`src/lib/api/http.ts` (fetch wrapper: Bearer header, `X-CSRF-Token` from the cookie, no body and no
content type on refresh and logout), `problem.ts` (problem+json to `ApiError`), `auth-api.ts` (five
routes, Zod-checked). `src/lib/auth/token-store.ts` (access token in memory only),
`csrf-cookie.ts` (reads `csrf_token` or `__Host-csrf_token`), `session.tsx` (`AuthProvider`:
restore on startup when a CSRF cookie exists, refresh 60 s before expiry, one refresh at a time per
tab, 401 then refresh once then retry once, 300 ms wait and one retry when a refresh gets a 401,
logout clears memory even when the call fails). `vite.config.ts`: `server.proxy` and
`preview.proxy`. README: web section.

Dependencies: `zod` (same version as the API), `msw` (dev).

## PR 2: screens

Atoms `Button`, `TextInput`, `Label`, `InlineError`; molecules `FormField`, `PasswordField`,
`ErrorSummary`; organisms `RegisterForm`, `LoginForm`; templates `AuthLayout`, `AppLayout`; pages
`HomePage`, `RegisterPage`, `LoginPage`, `AppHomePage`, `NotFoundPage`; guards `RequireAuth` and
`RedirectIfSignedIn` (the return address is accepted only if it starts with a single `/`). Tokens
get border, danger and success colours (contrast-checked in both themes).

| API answer           | Screen                                                           |
| -------------------- | ---------------------------------------------------------------- |
| 400 with `errors[]`  | each message under its field plus the summary, focus on summary  |
| 401 on login         | "Email or password is incorrect"                                 |
| 409 on register      | under the email field: "That email is already registered"        |
| 429                  | "Too many attempts. Try again in N seconds" (from `Retry-After`) |
| 503                  | "The service is busy. Try again in a moment"                     |
| network error, other | generic text, never raw server text for unknown cases            |

Dependencies: `react-router`, `@testing-library/user-event`, `vitest-axe`, `@playwright/test`.

## Test plan (edge cases)

- Token never in any storage; CSRF cookie under either name, missing, special characters.
- HTTP wrapper: no body or content type on refresh and logout; headers only when needed;
  problem+json, non-JSON errors (proxy 502), responses failing the Zod check, network failure, abort.
- Session: startup with and without cookie; refresh success, 401, race; five parallel requests make
  one refresh; timer refresh 60 s early (fake timers); one retry only, no loops; logout failure;
  no leaked timer on unmount.
- Forms: empty fields; every row of the table; double submit sends one request; busy label;
  focus on summary; passwords with spaces, emoji and 128 characters are sent untouched; paste
  allowed; `autocomplete` values; show-password toggle by keyboard.
- Guards: redirects, return address (`//evil.com`, `https://evil.com`, `/\evil` ignored), 404.
- Accessibility: axe finds nothing on every page and error state in both themes; tab order; labels;
  `aria-describedby`; page titles and focus on the heading after route changes.
- End-to-end (Chromium, real API and test database, real proxy): sign up, reload, sign out, wrong
  password, duplicate email, two tabs, no token in storage, refresh cookie is `HttpOnly`.

## Security, accessibility, performance

OWASP A01 (guards are convenience, the API enforces), A02 and A07 (no tokens in storage, CSRF
header), A03 (no `dangerouslySetInnerHTML`), A04 (generic login message), no open redirect, no
secrets in the bundle. WCAG 2.2 AA: accessible authentication (3.3.8), input purposes (1.3.5),
target size (2.5.8), visible focus, contrast 4.5:1, reflow at 320 px, reduced motion, announced
status messages. Bundle budget proposal: first load under 150 kB gzipped, reported in PR 2. The CSP
and the production reverse-proxy rule for `/auth` stay in Step 6; the built page must have no
inline scripts so that CSP is possible. `/auth` is a reserved address prefix: no page of that name.

## Alternatives not taken

Web Locks API for cross-tab refresh (the retry rule covers it; revisit if end-to-end tests show
races), TanStack Query (decide in Step 4), generated API types (revisit in Step 4).

## Deviations and outcome notes

- `msw` 2.15.0 instead of 3.0.3: version 3 is a major release from 2026-09-28, too young to adopt.

### PR 1 outcome (`feat/web-auth-foundation`, 2026-11-02)

- Checks: Biome and `tsc` clean; web build ok (bundle unchanged, the new code is not used by a
  page yet); 180 web tests (was 3), 648 API unit and 446 integration tests unchanged; `bun audit`
  clean. A real run of the API behind the Vite dev server (read-only requests) showed that `/auth`
  is forwarded with its path and its `Origin` header unchanged (a foreign `Origin` still gets 403)
  and that page routes such as `/login` are not forwarded. The cookie round trip itself (Set-Cookie
  through the proxy) is left to the Playwright tests in PR 2, because it needs a write to the database.
- Design of the session code: `session-manager.ts` holds all the rules without React (so they are
  tested with fake timers and a fake API); `session.tsx` only connects it to React with
  `useSyncExternalStore`. `start()` and `stop()` exist so React's StrictMode (effects run twice in
  development) neither restores twice nor loses the refresh timer.
- Added beyond the plan, found while writing the tests:
  - A refresh that started before a sign-out cannot bring the login back when its answer arrives
    (an `epoch` counter).
  - Unexpected failures (a bug, an answer in the wrong shape) go to `reportError` instead of being
    turned silently into "signed out"; expected ones (`ApiError`, `NetworkError`) do not.
  - The timer delay is capped at 2,147,483,647 ms: a browser timer overflows above that and fires
    at once, so a very long `ACCESS_TOKEN_TTL_SECONDS` would have caused a refresh loop.
  - The HTTP wrapper refuses any path that would leave the page's own origin, so a bug can never
    send the access token or the CSRF code to another host.
- Known limits, accepted: a network or server failure while restoring shows "signed out" (the
  cookie stays valid, so logging in again or reloading recovers); other tabs learn about a sign-out
  only when their own token expires or a call gets a 401; `signOut()` returns `false` when the
  server could not be reached, and PR 2 must tell the person (the refresh cookie is `HttpOnly`, so
  the page cannot delete it itself).
- Test-code corrections made on the way (premises that were wrong, not behaviour changed to pass):
  the `setup(undefined)` helper silently used its default cookie; the "loading first" test ignored
  that no cookie means signed out at once; the abort check had to compare the error name because
  the test environment has its own `DOMException`.
