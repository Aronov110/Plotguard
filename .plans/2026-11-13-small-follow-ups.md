Status: done (2026-11-13), all three PRs built (PR 3 pending review and merge). Decisions taken as recommended
("a for all"): 1-A three PRs; 2-A a `cspell.json` for the spell checker; 3-A the lock timeout is 5
seconds; 4-A the three heavy page tests get a 15-second timeout.

# The small follow-ups

## Goal

Clear the small items that earlier plans left open, in three PRs: (1) tidy the web and tooling,
(2) API correctness, (3) API robustness. Storybook is not small (a new tool and stories for about 25
components) and is not part of this.

## PR 1: tidy the web and tooling (`chore/web-tidy`)

- `FormEvent<HTMLFormElement>` (marked deprecated in React's types: "it does not exist") becomes React's
  `SubmitEvent<HTMLFormElement>`, imported under another name so it does not clash with the browser's
  global `SubmitEvent`. Five files: `use-auth-form.ts`, `use-project-form.ts`, `use-add-item.ts`,
  `RenameItemForm.tsx`, `MoveItemForm.tsx`. Types only.
- `cspell.json` at the root (the words "logline" and "loglines", and the paths to ignore). No new
  dependency: the editor extension reads it.
- The three heaviest `WritingPage-item-actions` tests get an explicit 15-second timeout. On a quiet
  machine they take about a second; under extreme load they passed the 5-second default.

## PR 2: API correctness (`fix/api-title-surrogate-and-tests`)

- Project titles and loglines (and document titles, which use the same rule) refuse a lone surrogate
  with a 400 (`isWellFormed`), like the document text.
- `routes/projects.ts` uses the shared `createWriteLimit` (same counter name, same behavior).
- An integration test: deleting a document through the documents service leaves its `ai_analyses`
  rows, with `document_id` NULL.

## PR 3: API robustness (`feat/api-lock-timeout`)

Document writes (create, save, move, delete) wait at most 5 seconds for the project lock
(`set local lock_timeout`). On a timeout the API answers 503 with `Retry-After` (the existing
`ServiceBusyError`). The timeout is a service option so tests can use a short one. The web screen
already words a 503 and retries saves by itself.

## Test plan and edge cases

PR 1: web unit tests of the five forms; lint and typecheck; the earlier stress test for the timeouts.
PR 2: schema and route tests (lone high or low surrogate, a good emoji pair, an emoji at the limit;
for a project title, a logline and a document title); the shared limit still gives 429 with
`Retry-After`; the real `ai_analyses` path. PR 3: a second connection holds the project lock, and a
create, a save, a move and a delete each get 503 with `Retry-After`; after the release the same
request works; nothing is half-written; someone else's project is still 404.

## Security and accessibility notes

OWASP A04 (a wait without a limit on the lock lets slow writes pile up requests), A03 (broken
characters are refused instead of silently changed), A09 (logs name the route, never titles or text).
No UI change; the screen already announces a 503. No new dependency in any PR.

## Alternatives and risks

Rejected: a `.vscode/settings.json` word list (editor-specific); a `NOWAIT` lock (fails at once, too
brittle for two tabs of one writer); a timeout in application code (leaves the database waiting).
Risks: PR 3's tests need two database connections and careful timing (run repeatedly); PR 2 changes
what the API accepts (a stored title with a broken character could not be saved again unchanged).

## Outcome

PR 1: done as planned. Lint, typecheck and `bun audit` clean; web unit 1652 passed and API 930 passed
(unchanged, as only types, a config file and two test timeouts changed). `FormEvent` no longer appears
anywhere in `apps/web/src`. The spell checker itself was not run (it is an editor extension), so the
"logline" hint going away is not verified here. PRs 2 and 3 are still to do.

PR 2: done as planned. Lint, typecheck and `bun audit` clean; API unit 930 -> 941 (11 new), API integration
776 passed; web untouched. Titles and loglines (and document titles, which share the rule) now refuse a
lone surrogate with 400 ("The title contains an invalid character."); the five new route tests fail
against the old schema and pass with the fix; a whole emoji is still accepted and stored exactly.
`routes/projects.ts` uses the shared `createWriteLimit` (27 lines removed, same counter name; the
project limits, CRUD and access tests pass unchanged). New integration tests (in
`documents-crud.integration.test.ts`): deleting a document through the API keeps its analyses with
`document_id` NULL, leaves other documents' and whole-project analyses alone, unlinks the analyses of an
act and of its scenes, and keeps the analysis when the delete is refused. README: a line about titles and
loglines. A whole-suite browser run on `main` (before PR 2): 382 passed, 2 skipped, 2 failed; the two
(WebKit, the two-tab tests of 4d-2) were 30-second timeouts while other heavy jobs ran on the same
machine, and pass 3 of 3 when run alone in both browsers.

PR 3: done as planned. Lint, typecheck and `bun audit` clean; API unit 941 -> 945 (4 new: `isLockTimeout`),
API integration 776 -> 794 (18 new, in `documents-lock-timeout.integration.test.ts`); web untouched.
Every document change (create, save, move, delete) sets `lock_timeout` for its own transaction
(`set_config(..., true)`, five seconds by default, a service option) and a wait that runs out
(SQLSTATE 55P03) is answered 503 with `Retry-After: 2` (the existing `ServiceBusyError`), with no
`cause` so the query never reaches the log. Tests: a second connection holds the project row; each of
the four changes gets 503 within the bounds and changes nothing, and the same request works after the
release; reads, another project of the same person and a stranger (404, not 503) are not held up; a
lock released in time makes the change succeed; twelve waiting changes (more than the ten pooled
connections) all end with 503 and the pool still works; no lock setting is left on a connection;
the log holds neither the title nor the text nor the query; invalid timeout values (0, negative,
fractional, NaN, infinite) are refused with a RangeError. Mutation check, 4 of 4 caught (no timeout
set; 503 not mapped; setting kept for the whole connection; timeout 100 times too long); 12 runs of the
new file in a row all passed. Cost: one extra statement per change (about a millisecond). README and the
route descriptions mention the 503. Not changed: the project routes (their changes do not wait for
the documents lock) and the web screen (it already words a 503 and retries saves).
