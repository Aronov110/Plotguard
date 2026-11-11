Status: done (2026-11-05). Decisions taken as recommended: 1-A (fix one tab only; the
cross-tab case stays open and is documented) and 2-A (keep the "Signing you in…" wording).

# Fix: a late sign-out reply deletes the new login's cookies (review finding 2)

## Goal

A sign-out followed at once by a login must never leave the person signed out. Done means: the
browser test in `sign-out-race.e2e.ts` passes without `test.fail`; new unit tests cover the
ordering; the README no longer lists the bug.

What happened before: the page signs out at once and sends `POST /auth/logout`; the person logs in
again before the answer arrives; the answer's `Set-Cookie` deletions then hit the new login's
cookies, so a reload shows the person signed out.

## Tech choices

- No new dependency, no new tool. Fix in the session manager (`session-manager.ts`), which already
  owns the sign-in/sign-out sequence and is testable without React.
- Pattern: a login or sign-up waits until every sign-out request that is still in flight has
  finished (a set of pending promises). The 15 s request timeout in `http.ts` guarantees that every
  such request ends, so the wait is bounded.
- Tests: Vitest + Testing Library for units, Playwright for the browser (all already in the repo).

## Files

- `apps/web/src/lib/auth/session-manager.ts`: track pending logout requests; `login` and `register`
  wait for them (in a loop); JSDoc updated.
- `apps/web/src/lib/auth/__tests__/session-manager-logout-order.test.ts` (new): the ordering tests.
- `apps/web/src/lib/auth/__tests__/session-signout.test.tsx`: React-level tests.
- `apps/web/e2e/sign-out-race.e2e.ts`: `test.fail` removed, test rewritten, different-account case.
- `README.md`: the "Known bug" bullet replaced.
- `.plans/2026-11-02-auth-frontend.md`: outcome note updated.
- `.plans/2026-11-05-sign-out-login-race.md`: this plan.

The API and the screens are not touched.

## Test plan and edge cases

Unit (session manager, fake API calls that tests hold open): login and register do not call the API
while a sign-out is pending and do after; they still go ahead after a failed (network, 403) or
unexpectedly throwing sign-out; several pending sign-outs; a sign-out that starts during the wait;
nothing pending means no waiting; an old finished sign-out no longer delays; state stays signed-out
with no token while waiting and is signed-in with one timer afterwards; a failed login after the
wait rethrows and changes nothing; a sign-out announced by another tab does not delay a login; an
old refresh answer cannot revive the old login.

React: submitting the form after a held sign-out shows the busy state and sends nothing yet; the
"sign-out was not confirmed" notice disappears after a login that waited.

Browser: with the logout reply held, a submitted login shows busy and is sent only after the logout
response (checked from the recorded order, not timing); the person ends signed in, cookies are
present, a reload keeps the login; the same with a different account.

## Security and a11y notes

- OWASP A07 (authentication and session handling): removes an unexpected sign-out; the old login is
  still revoked at once because the logout request is still sent immediately. A04 (insecure design):
  state-changing auth requests are now ordered. Availability: a stuck server delays a login by at
  most the existing 15 s timeout.
- WCAG 2.2 AA: no visual change; the existing polite "Signing you in…" status is announced (4.1.3).

## Alternatives and risks

- Also lock across tabs with the Web Locks API: rejected for now (needs a Safari < 15.4 fallback and
  covers a case that was not reproduced). The cross-tab race stays open.
- New wording "Finishing your sign-out…": rejected (extra state and tests for little gain).
- Stop the API's logout reply from deleting cookies: rejected (changes the documented contract).
- Disable the login form during sign-out: only hides the problem.
- Not fixed here: a late refresh answer may re-set cookies for a login the server already ended; the
  page ignores it (`epoch`), a reload then gets a 401. To be probed in a later PR.

## Outcome

Done as planned, no deviations. `login` and `register` wait for the sign-out requests of the tab
that are still in flight (`pendingLogouts` in `session-manager.ts`); with nothing pending they send
at once, so the normal path is unchanged.

- Unit tests: web 714 -> 743 (25 in the new `session-manager-logout-order.test.ts`, 3 in
  `LoginForm.test.tsx`, 1 in `session-signout.test.tsx`). With the wait switched off temporarily,
  8 of the 25 fail, so they do catch the bug. API untouched (692).
- Browser tests: the finding-2 test passes without `test.fail`, on Chromium and WebKit; a second
  test covers logging in as another person. Two full runs: 171 passed, 1 skipped (as before), and
  170 passed + 1 failed + 1 skipped.
- The one failure is an older test, `cookies-and-storage.e2e.ts` "both cookies are gone after
  signing out" (WebKit): it reads the cookies right after the URL changes to /login, before the
  sign-out answer has arrived. It is a timing mistake in that test, not in this fix (no login
  involved). Not changed here; flagged for its own small fix (wait with `expect.poll`). Fixed later
  in `2026-11-11-sign-out-cookie-test.md`.
- One more WebKit failure in ~100 runs of the new tests: the Email field was empty after a fill
  (trace: no login request was ever sent, so it happened before the code of this fix runs). Cause
  not found; the probe with 40 plain sign-outs and 85 repeats of the new tests did not reproduce it.
  Open point.
- Still open, as planned: sign-out in one tab and login in another at the same moment, and a late
  refresh answer re-setting cookies.
