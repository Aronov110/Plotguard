Status: done (2026-11-04), PR number not recorded here. Decisions taken as recommended: Chromium +
WebKit; if the finding-2 test shows a real bug it is recorded as a known failing test and fixed in
its own PR; the API gets a test-only starter with relaxed limits. See "Outcome" at the end.

# PR 3: Playwright end-to-end tests for the web auth screens

## Goal

Drive a real browser through the real web app and the real API, and close the three gaps left open
in PR #9. Done means: `bun run test:e2e` passes on Chromium and WebKit; the login cookie round trip
through the dev proxy is proven; axe passes in light and dark mode with contrast on; review finding 2
(a late logout reply possibly clearing a newer login) is reproduced or ruled out; the README explains
how to run it.

## Tech choices

- `@playwright/test` 1.64.1, pinned exactly (released 2026-10-14). New dependency, mature tool.
- Browsers: Chromium and WebKit (one-time download).
- Accessibility: the repo's own `axe-core` 4.14.0, injected into the page (no second axe package).
- Database: a separate throwaway `plotpal_e2e_test`, rebuilt on every run (never dev data, never the
  shared integration database).
- Web: `vite preview` on 4173 (production build). API: a test-only entry on 3100 with relaxed auth
  limits. Neither clashes with the dev servers on 3000 and 5173; running servers are never reused.
- Files: `apps/web/e2e/*.e2e.ts`; the ending keeps Vitest from collecting them.
- No CI exists, so these tests run only on request and are not part of `bun run test`.

## Files

New: `apps/web/playwright.config.ts`; `apps/web/e2e/support/{axe,users,gate}.ts`;
`apps/web/e2e/{journeys,cookies-and-storage,guards-and-proxy,accessibility,keyboard-and-focus,sign-out-race}.e2e.ts`;
`apps/api/src/test-support/{e2e-config,e2e-server}.ts` and `__tests__/e2e-config.test.ts`; this plan.
Modified: `apps/web/package.json`, `package.json`, `bun.lock`, `apps/web/vite.config.ts` (Vitest
ignores `e2e/**`), `apps/web/tsconfig.json`, `README.md`, `.plans/2026-11-02-auth-frontend.md`.

## Tests and edge cases

- API starter (Vitest): refuses production; refuses names not ending in `_test`; refuses the shared
  integration database; refuses a missing `TEST_DATABASE_URL`; allows only the e2e origin; binds only
  to loopback; messages never contain secret values.
- Journeys: sign up, reload, sign out, sign in; guard redirect and return path; uniform error for
  wrong password and unknown email; duplicate email (409); weak password (API field message); empty
  fields; trimmed email, untrimmed password with spaces and emoji; double-click sends once.
- Cookies and storage: refresh cookie HttpOnly, SameSite=Strict, Path=/auth; CSRF cookie readable,
  SameSite=Strict, Path=/; both cleared on sign-out; no token in localStorage, sessionStorage or
  IndexedDB.
- Guards and proxy: `/auth/me` is API JSON (401); `/authors` and `/auth-callback` are web pages;
  signed-in `/login` redirects to `/app`; unknown route shows 404.
- Accessibility: axe in light and dark with contrast on, on `/`, `/login`, `/register`, `/app`, 404
  and on the error, revealed-password and sign-out-notice states; one `h1`, `lang` and a title per
  page; no sideways scrolling at 320 px; targets at least 24x24 px.
- Keyboard and focus: skip link first; form usable by keyboard alone; focus to the error summary
  after a failed submit and to the `h1` after navigation; visible, unobscured focus ring.
- Finding 2: sign out with the reply held, sign in again, release the old reply, reload, check the
  new login survives.

## Security and accessibility

- OWASP risk classes: access control (guards), authentication failures (uniform errors, cookie
  flags), misconfiguration (loopback only, throwaway database, never production), sensitive data in
  test output (traces and videos can hold typed passwords and cookies: fake users only, artifacts stay
  in gitignored `test-results/`, never uploaded), supply chain (exact pin, `bun audit`).
- Cookie tests use the development flavour (no `Secure`, no `__Host-` prefix) because plain http
  cannot carry the production one; the README says so. The login-throttling message is not covered.
- WCAG 2.2 AA added: contrast, reflow at 320 px, target size, visible and unobscured focus, titles,
  language, keyboard operation, heading structure.

## Alternatives and risks

- Not taken: Cypress (no WebKit), the dev server and dev database, `@axe-core/playwright`, Firefox
  (possible later), a sign-up shortcut that skips the form.
- Risks: finding 2 may really fail; Set-Cookie on a held reply must be proven in a spike on both
  browsers; Windows and WebKit flakiness; `vite preview` must read `API_URL` from the process
  environment; Playwright must run through Node, not the Bun runtime; no fixed sleeps; first run is
  slow because of the download; the PR is about 20 files.
- Work order: (1) spike: config, servers, one smoke test, shown before the rest; (2) helpers, API
  starter and its unit tests; (3) specs; (4) README and plan updates.

## Outcome (2026-11-04)

Result: 170 browser tests (85 per browser): 169 pass, 1 is skipped on WebKit, and the finding-2 test
is an expected failure (counted as passing). Three full runs in a row were green at the end.
API unit tests: 692 (was 648; 44 new for the e2e starter's rules and the reply hold).

Deviations from the plan above, with the reason:

- **Reply hold lives in the API, not in the browser.** The spike showed that holding a reply with
  Playwright's `route.fetch()` re-sends the request from outside the browser, and the API's origin
  check refuses it (403). The e2e starter now has two loopback-only routes, `/__e2e/hold-next-logout-reply`
  and `/__e2e/release-logout-reply`, plus an `onSend` hook; the logic is in `e2e-reply-hold.ts` with
  unit tests. `e2e/support/gate.ts` and the spike file were removed because nothing needed them.
- **The web app is built with `NODE_ENV=development` for the run**, not as a production build. A
  production bundle reads only the `__Host-csrf_token` cookie, while the development API (plain
  http) sets `csrf_token`, so the page never found the CSRF code: no session restore (zero
  `/auth/refresh` calls) and every logout refused with 403. Production cookie names and flags need
  https and remain untested. Not an app bug: both sides are consistent in production.
- **One test at a time** (`workers: 1`), because the API has a single "hold the next logout reply"
  switch.
- **SameSite is checked on the raw `Set-Cookie` header**, through the proxy and directly, because
  Playwright's WebKit reports `Strict` cookies as `None`.
- **WebKit does not Tab to links** (measured: Tab and Alt+Tab both skip them), so link tab stops
  are left out of the WebKit checks and the skip-link test runs on Chromium only.
- **Two test premises were wrong and were corrected, not the app:** signing out replaces the
  `/app` history entry, so Back never leads to it (the test now checks that no entry shows private
  content); and navigating away while a reply is held cancels the request (the test now stays on
  the page and checks the server side with the browser's own cookies).

Finding 2 is **real**: a sign-out answer that arrives after a new login deletes the new login's
cookies (after the late answer the browser holds no cookies at all), so a reload shows the person
signed out. The test is marked `test.fail` and the fix is its own PR, as decided.

Open points:

- One unexplained failure in an early full run: `a signed-out visit to /app ... returns to /app after
  login` on WebKit stayed on `/login` once. It passed 40 of 40 repeats on its own and in the last
  three full runs. The API log had one successful login fewer than expected, which suggests the
  form submit never reached the API, but that is an inference: the trace of that run was lost to the
  next run. Watch for it; do not hide it behind retries.
- Not covered: the login throttling message, production cookies over https, WebKit link tab stops,
  Firefox.
