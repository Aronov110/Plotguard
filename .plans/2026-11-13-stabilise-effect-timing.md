Status: done (2026-11-13), pending review and merge. Approved the same day.

# Stabilise four flaky unit tests

## Goal

Four tests from 4d-1 fail now and then when the machine is busy (8 of 32 runs when the two files ran in
parallel). Done means: none of them fails over 64 parallel runs, the assertions are as strict as
before, and the app code is untouched.

## Cause

The tests check as soon as an element appears, but React runs its effects a moment later: the page
title, the focus, the `beforeunload` listener and the subscription to the autosave status are all set
in effects. Under load the check comes first.

## Files (under `apps/web/src/`)

- `components/pages/WritingPage/__tests__/WritingPage.test.tsx`: wait for the title.
- `components/organisms/DocumentEditor/__tests__/DocumentEditor.test.tsx`: `readyEditor` lets the
  effects finish; the focus test waits for the focus.

## Test plan

Repeat the two files 8 times in each of 4 parallel loops before and after the change (before: 8 of
32 runs failed); then 64 runs after; then the full web unit suite.

## Security and accessibility notes

None: tests only.

## Alternatives and risks

Rejected: raising timeouts (slower, still racy), retrying failed tests (hides real flakiness). Risk: a
helper that waits too little would not fix it, so the stress run decides. Other tests with the same
pattern that did not flake are listed in the outcome, not changed.

## Outcome

Done as planned. App code untouched; four tests changed in two files.

- Before: running the two files 32 times in parallel (4 loops of 8) failed in 8 runs, always in the
  four tests named above (the title 4 times, the close-tab listener 2, "Unsaved changes" 2, the focus 1;
  one run had two failures). After: the same load, 32 of 32 runs passed.
- Full suites on a quiet machine: web 1652 passed, API 930 passed, lint and typecheck clean.
- A heavier load (8 loops of 8, about 24 test processes at once) still failed 8 of 64 runs, but only
  with the 5-second test timeout, in three of the new 4d-2 page tests
  (`WritingPage-item-actions`: the axe test 6 times, two others once each). On a quiet machine the
  slowest of them takes under a second, so there is a 5x margin; they were not changed.
- Other tests with the same early-check pattern, not changed because they did not flake (most check
  right after a synchronous `render`, which runs inside `act` and flushes effects): the `document.title`
  checks in the page tests and `use-page-title.test.tsx`; the `toHaveFocus` checks after an async load
  in `ItemToolbar`, `ProjectList`, `AppHomePage`, `ProjectEntry`, `CreateProjectForm`, `AddItemForm` and
  `WritingPage-item-actions`.
