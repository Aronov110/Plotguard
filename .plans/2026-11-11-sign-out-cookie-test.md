Status: done (2026-11-11), pending review and merge. Decision taken: fix it in its own small PR,
separate from the projects screen (4c-1), as `2026-11-05-sign-out-login-race.md` had flagged.

# Fix the timing mistake in the browser test "both cookies are gone after signing out"

## Goal

`cookies-and-storage.e2e.ts` "both cookies are gone after signing out" failed now and then in both
browsers. After the sign-out button is pressed the page shows the login screen at once, but the
browser deletes the cookies only when the server's sign-out answer arrives. The test read the cookies
the moment the screen changed, so it sometimes looked before they were gone. Done means: no failures
in many repeated runs, and the test still fails when the cookies really stay.

## Change

One file, `apps/web/e2e/cookies-and-storage.e2e.ts`: the two checks use `expect.poll`, which keeps
asking for up to the polling timeout (5 s) until the cookie is gone. The assertions are as strict as
before (both cookies must be gone); only the moment of looking changed. `journeys.e2e.ts` already
waits the same way after a sign-out. The other places that read cookies do so after a login or sign-up
(the cookies arrive with the answer that moves the page on) and are not affected.

## Test plan and results

- Before, on `main`: 10 failures in 80 runs (40 in Chromium, 40 in WebKit).
- After: 0 failures in 80 runs.
- Check that it can still fail: with the sign-out request made to fail (so the cookies stay), the test
  fails after the 5 s wait, with the cookies listed. The test file was restored afterwards.
- Application code untouched, so no unit tests are affected. No security or accessibility impact.

## Alternatives and risks

Waiting for the sign-out answer with `page.waitForResponse` was considered; polling the cookies
checks the thing the test is about (the cookies) and needs no knowledge of the request. Risk: a real
bug that deletes the cookies too late (after 5 s) would now fail the test; that is intended.
