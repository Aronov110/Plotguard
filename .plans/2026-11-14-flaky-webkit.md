Status: approved (2026-11-14). Decisions taken as recommended ("a for all"): fix the app, not the tests; own
branch `fix/route-focus-race` from `main`, apart from the CI PR.

# Flaky WebKit login tests: do not take the focus from a field

## Goal

`RouteFocus` never takes the focus away from a text field that already has it, and the WebKit login
tests (`writing.e2e.ts` "a signed-out visit goes to the login screen…", the two `sign-out-race` tests)
stop failing at random. The stress runs are supporting evidence, not proof (see below).

## What was found (read-only investigation)

- Symptom: the email field is empty and the password is filled; the form then refuses the empty email
  (in `sign-out-race`: no busy state). Under CPU load: 1 failure in 36 runs; in two full browser runs,
  the login test once and two sign-out tests once.
- The trace shows the email empty right after its fill finished, and that fill took 88 ms to start.
- The form's DOM node is not replaced after it first appears (60 and then 150 probe runs, one node each),
  so it is not a session-state remount. 0 failures in 270 probe runs: the cause could not be reproduced.
- Leading hypothesis (not proven): `RouteFocus` moves the focus to the page heading in an effect that runs
  after paint. Under load it can land while Playwright is typing (WebKit fills by focusing the field and
  inserting text into whatever has the focus), and the text is lost.

## Tech choices

Plain React and DOM, no new dependency, no retry or longer timeout (the repo's policy in
`playwright.config.ts`: a test that passes only on a second try must fail loudly).

## Files

`apps/web/src/components/templates/RouteFocus/RouteFocus.tsx` (check `document.activeElement` first; leave a
text field alone), its test file, this plan. No change to the e2e tests or the Playwright config.

## Test plan

New unit tests (the first fails on the old code): a page that autofocuses its first field keeps it (input,
textarea, select, editable element); focus on a link, a button or the body still moves to the heading; no
heading, same path and query-only stay no-ops, also under StrictMode. Stress: before the fix the WebKit login
and sign-out tests repeated under full CPU load (may not fail again; said plainly); after it the full WebKit
suite three times and the focused repeat under load.

## Security and accessibility

Helps WCAG 3.2.1 (On Focus) and 2.4.3 (Focus Order): focus is not pulled out of a field in use. Screen readers
still hear the new heading whenever the focus is not in a field. No OWASP impact.

## Alternatives and risks

Rejected: retrying the fill in tests (`toPass`), `retries: 1`, longer timeouts, skipping WebKit. If the
hypothesis is wrong the flake persists: then capture a focus/input event log in CI. Risk: a screen reader user
already in a field that survives the navigation gets no heading announcement (rare, and the right call).
