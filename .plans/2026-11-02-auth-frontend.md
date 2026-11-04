Status: done (2026-11-02, finished 2026-11-04), merged in PRs #8 and #9. All recommended options
accepted, two-PR split accepted, new dependencies accepted, Storybook goes into its own small PR
before Step 4. Not part of the merged work: the Playwright tests (see "Outcome" at the end).

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
`RedirectIfSignedIn` (the return address is checked by resolving it, see "Security review of PR 1"
below; starting with a single `/` is not enough). Tokens get border, danger and success colours
(contrast-checked in both themes).

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
  cookie stays valid, so logging in again or reloading recovers); `signOut()` returns `false` when
  the server could not be reached, and PR 2 must tell the person (the refresh cookie is `HttpOnly`,
  so the page cannot delete it itself).
- Test-code corrections made on the way (premises that were wrong, not behaviour changed to pass):
  the `setup(undefined)` helper silently used its default cookie; the "loading first" test ignored
  that no cookie means signed out at once; the abort check had to compare the error name because
  the test environment has its own `DOMException`.

## Security review of PR 1 (2026-11-02, `security-reviewer` agent)

No critical or high findings. Every claim was checked before anything was changed: M1 and L2 were
reproduced with a throwaway test, L6 with the running dev server (`/authors` was forwarded to the
API), L4 by reading the API's env schema (`REFRESH_REUSE_GRACE_SECONDS` accepts 0 to 60), M2 and L1
by reading `http.ts`. Decision: all recommended fixes in one extra commit on the same PR; for L4
only document it (no change to the merged API).

| #   | Finding                                                                                                                              | Fix                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | After `signOut()`, while the logout request travels, a 401 made `withAuth` refresh and revive the session in the UI                  | A refresh never starts while signed out (outcome `stale`)                                                                                                     |
| M2  | No timeout: a server that never answers left "loading" or "signing out" hanging                                                      | 15 s timeout per request (`timeoutMs`), built by hand for older Safari; a timeout is a `NetworkError`                                                         |
| L1  | `fetch` followed redirects (reproduced: a 307 to another host was followed)                                                          | `redirect: "error"`                                                                                                                                           |
| L2  | After a login during a refresh, `withAuth` joined the stale refresh and threw a 401                                                  | The shared refresh is keyed by login (`epoch`)                                                                                                                |
| L3  | A timer refresh that failed for a passing reason was never retried                                                                   | Retry after 5, 10, 20, 40 s, then every 60 s, while the login lasts                                                                                           |
| L4  | A tab that loses the refresh race twice signs itself out; `REFRESH_REUSE_GRACE_SECONDS=0` makes a normal two-tab race count as theft | README warning; no code change (grace default is 10)                                                                                                          |
| L5  | A production build also trusted a plain `csrf_token` that a sibling subdomain could plant                                            | The cookie name follows the build: `__Host-csrf_token` in production, `csrf_token` otherwise                                                                  |
| L6  | The `/auth` proxy key matched by prefix (`/authors` was forwarded to the API)                                                        | Regex key `^/auth(/\|\?\|$)`; README notes that `vite preview` (port 4173) needs its own `CORS_ORIGINS` entry                                                 |
| L7  | A sign-out in one tab left the other tabs working until their token expired                                                          | `BroadcastChannel` message carrying only the word `signed-out`; other tabs end their login at once                                                            |
| L8  | Server text in `ApiError` was unbounded                                                                                              | Messages 300, pointers 200, details 500 characters, at most 20 issues, control and invisible characters removed, problem code restricted to `[a-z0-9-]{1,64}` |

Not changed: jitter on the timers (the API's grace window already covers two tabs refreshing at
once). Not in scope here: CSP, `frame-ancestors`, HSTS and the reverse proxy passing the client IP
and `Origin` (Step 6, already on the list); the API's `trustProxy` setting was not checked.

Checks after the fixes: Biome and `tsc` clean; 283 web tests (was 180), 648 API unit and 446
integration tests unchanged; `bun audit` clean; web build unchanged. On the running dev server
`/authors`, `/auth-callback` and `/login` are pages and `/auth` and `/auth/...` reach the API. Test
premises that were wrong and corrected (the code was right): a tab-prefixed `https://` path in the
same-origin test stays on our own origin; the fake timer counted a timer that had already fired as
live; one old test asserted that a failed timer refresh is never retried, which is the opposite of
the approved L3 fix.

### Requirements for PR 2 (from the review)

1. **Return address after login.** "Starts with a single `/`" is not enough: `/\evil.com` and a
   path with a tab in it are read by browsers as `//evil.com`. Resolve it the way `ownOriginUrl`
   does (`new URL(value, location.origin).origin === location.origin`), navigate only to the
   parsed `pathname + search + hash`, refuse anything under `/auth`, and never pass the raw value
   to `window.location`. Tests: `//evil.com`, `https://evil.com`, `/\evil`, tab, newline and
   carriage-return variants.
2. **`signOut()` returning `false`.** Show "Could not confirm sign-out. Close this browser or try
   again" and offer a retry (a retry works while the CSRF cookie exists). After pressing sign-out
   nothing may call the API with the old token.
3. **Disable the forms while the state is `loading` and while a request is running.** One login at a
   time; never wrap `login` or `register` in `withAuth`.
4. **Rendering server text.** Plain React text only, no `dangerouslySetInnerHTML`, and no `title`
   or `aria-label` built from `detail`. Map `pointer` to fields through a fixed whitelist
   (`/email`, `/password`, `/displayName`); never use it as a DOM id or `htmlFor`. Unknown problems
   get generic text. `Retry-After` is only shown, never used to resubmit by itself.
5. **Forms.** `autocomplete` `email` or `username`, `current-password` on login, `new-password` on
   sign-up; do not trim passwords; paste allowed; no credentials in URLs, navigation state or
   logged state. `type="email"` only if the server's validation stays the rule.
6. **Every authenticated call goes through `withAuth`.**
7. **Sign-up enumeration:** the 409 "already registered" answer is an accepted trade-off (the API
   rate-limits sign-up); mention it in the PR so the owner can confirm.
8. **Step 6 reminders:** `frame-ancestors 'none'`, CSP, `Referrer-Policy`, `nosniff`, HSTS on the
   production host, and the `/auth` reverse-proxy rule must pass the real client IP and `Origin`.
9. **Tests still to add in PR 2:** a login during the "loading" state is impossible (form
   disabled); the Playwright round trip for the `Set-Cookie` headers through the proxy.

## PR 2 notes (`feat/web-auth-screens`, 2026-11-02)

Deviations from the approved dependency list, found while installing:

- `vitest-axe` is not used: its last release is from October 2022. `axe-core` 4.14.0 (Deque,
  maintained) is used directly through `test-support/a11y.ts`. Two helpers: one for a component,
  one for a whole page (landmarks, exactly one `main`, exactly one level-one heading). Color
  contrast cannot be computed without CSS, so `tokens.test.ts` checks every color pair of both
  themes against WCAG, and the Playwright tests run axe again in a real browser in both schemes.
- `react-router` 8.4.0 (seven weeks old) instead of the latest 8.5.1 (six days old).
- The test config now processes `tokens.css` (and only that CSS file), so the contrast test can
  read the real colors; `css: false` made a raw read return an empty string.
- Axe 4.14 no longer reports duplicate plain ids, and does not report content outside a landmark
  when it runs on a single component; the page helper therefore runs on the whole document.
- A space at the edge of an inline element is dropped by some accessible-name algorithms, which
  glued "Display name" to "(optional)" and "Error:" to the message. The spaces now sit outside the
  elements (`Label`, `InlineError`).

### Commit B: forms, pages and routing

- Screens: `/` landing, `/login`, `/register`, `/app` (placeholder), `*` not found. The guards
  `RequireAuth` and `RedirectIfSignedIn` live in `components/templates` (they render the "Checking
  your session…" screen while the login is being restored, so no form is usable too early).
- The return address is checked by resolving it against the page's origin (`safe-return-path.ts`),
  after the review showed that "starts with a single `/`" accepts `/\evil.example`. It also refuses
  `/auth` and `/%61uth` (the API's address space) and broken percent-encoding. It travels in the
  router's history state, never in the query string.
- Both forms share `lib/auth/use-auth-form.ts`: fields are read from the form when it is sent
  (the password is never copied into React state), the email and display name are trimmed and the
  password never is, one request at a time (a ref guards against two clicks before React re-renders),
  every failure is mapped by `lib/auth/form-feedback.ts` to a fixed sentence or to the API's own
  per-field message, and the focus moves to the error summary. Unexpected errors go to the console.
- The "sign-out was not confirmed" state lives in `AuthProvider` (`signOutUnconfirmed`), not in a
  screen: the screen that asked for the sign-out is gone by the time the answer arrives. The login
  page shows `SignOutNotice` with a "Try signing out again" button.
- `RouteFocus` moves the focus to the new screen's `h1` after a navigation (not on first load,
  StrictMode-safe); `usePageTitle` sets the tab title; `AppLayout` has a skip link.
- Deviations: `FormField` accepts `error: undefined` explicitly; `Button.css` and `tokens.css` got
  `text-decoration: none` for links styled as buttons and a base `a` color.
- Test fix: tests that waited for the fake server with a fixed delay (150 ms, 100 ms, 60 ms) were
  races on a slow machine (one failed in a full run). The fake server now holds its answer until the
  test opens a gate (`deferred`), which is deterministic. The web suite was run three times in a row.
- Checks: Biome and `tsc` clean; 706 web tests (was 283), 648 API unit and 446 integration tests
  unchanged; `bun audit` clean; first-load bundle 111.6 kB JS + 1.6 kB CSS gzipped (budget 150 kB).

### Review of commit B (2026-11-04, `security-reviewer` agent plus a manual read)

No critical or high findings. The checks were re-run first: Biome and `tsc` clean, 706 web tests.
Everything below was read in the code before a decision; the return-address case was also tried in
a test browser environment (jsdom).

| #   | Finding                                                                                                                               | Decision                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | If `signOut()` threw an unexpected error, `signOutUnconfirmed` was never set, so the "not confirmed" warning did not show             | Fixed in `AuthProvider.signOut`: the error is caught and logged, counts as "not confirmed", and the call never rejects. The flag is not set before the call, so a normal sign-out never flashes the warning |
| 2   | Retrying a sign-out while a login runs (or a sign-out followed at once by a login) might let the old logout reply clear the new login | Not fixed. Plausible, not reproduced. To be tried in the Playwright tests before choosing a fix                                                                                                             |
| 3   | `safeReturnPath` returned `//…` for `/.//evil.example`. The router collapses double slashes, so it is not exploitable today           | Fixed: a result that starts with `//` is refused; four test cases added                                                                                                                                     |
| 4   | A 400 issue whose pointer is not one of the three fields has the API's own message shown in the summary (plain text, capped, cleaned) | Accepted as it is (owner's decision): it matches the table above, and the API is the one rulebook                                                                                                           |
| 5   | The password field had no spellcheck, autocapitalize or autocorrect opt-out, which matters while the password is shown                | Fixed in `PasswordField` (a file of the first commit, so a separate small commit)                                                                                                                           |
| 6   | Trivial: comment above the JSDoc in `routes.tsx`; no JSDoc on `LoginPage` and `RegisterPage`                                          | Fixed                                                                                                                                                                                                       |

Not changed: the unused `displayName` id in `LoginForm` (the shared type needs all three ids;
loosening it touches four files). Information only: the web host must send the CSP and
`frame-ancestors` (Step 6); the new code has no inline script or style, so a strict CSP is possible.

Checks after the fixes: Biome and `tsc` clean; 714 web tests (was 706); the API was not touched and
was not re-run. The first-load bundle was not measured again after these small changes.

## Outcome (2026-11-04)

PR 1 merged as #8 and PR 2 as #9. PR 2 went in **without the Playwright tests** this plan promised
for it (decision of 2026-11-04, see `2026-11-04-push-web-auth-screens.md`). They became their own
PR 3 (`2026-11-04-playwright-e2e.md`), which proves the `Set-Cookie` round trip through the dev
proxy and axe in a real browser in both colour schemes. Finding 2 of the review above turned out to
be **real**: a sign-out answer that arrives after a new login deletes the new login's cookies. It is
recorded as an expected-failure test and needs its own fix PR. Storybook is still its own small PR
before Step 4.
