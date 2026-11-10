Status: done (2026-11-07). Decisions taken as recommended ("A for all"): 1-A a `version`
column plus migration `0002`; 2-A saving text also moves the project to the top of the project list;
3-A the outline is returned whole in one response (cap of 1,000 items per project), no pagination;
4-A text up to 200,000 characters, route body limit 2.5 MiB; 5-A documents get their own write
limit of 120 per minute per person.

# Step 4, PR 4b: documents API

## Goal

A signed-in writer can see the outline of one of their projects (acts, chapters and scenes), add,
rename, move and delete outline items, and read and save the text of each one. Nobody can reach
anyone else's text, and two tabs saving the same item can never silently overwrite each other.

Routes (all under `/projects/:projectId/documents`, so the web proxy needs no new rule; all need
`Authorization: Bearer`):

| Route                    | Does                                                      |
| ------------------------ | --------------------------------------------------------- |
| `GET …/documents`        | the whole outline, without text, in order                 |
| `POST …/documents`       | add an item (201)                                         |
| `GET …/documents/:id`    | one item with its text and its `version` (also as `ETag`) |
| `PATCH …/documents/:id`  | rename, move, or save text; **needs `If-Match`**          |
| `DELETE …/documents/:id` | delete; its children go too (204)                         |

## Tech choices

No new dependency. Fastify + Zod + Drizzle + Vitest on the real test database, as in 4a. A new
`version` integer column (migration `0002`, existing rows start at 1) is the value behind `If-Match`
/ `ETag`. Every outline change first locks the project row (`SELECT … FOR UPDATE`), so one change
at a time runs per project; this also closes the race the depth trigger documents.

## Files (all in `apps/api/src/` unless noted)

New: `documents/{schemas,service,etag,word-count,limits}.ts`, `routes/documents.ts`,
`test-support/documents-api.ts`, tests in `__tests__/`, migration `apps/api/drizzle/0002_…sql`.
Modified: `db/schema/documents.ts` (version), `errors/app-error.ts` (428 and 412), `app.ts`,
`plugins/openapi.ts`, `test-support/auth-app.ts`, `README.md`, this plan. Nothing in `apps/web`.

## Defaults taken

Missing `If-Match` gives 428, stale gives 412, malformed gives 400. Another person's project, or a
document reached through the wrong project, gives 404. A position beyond the end of the siblings
gives 400; leaving it out appends. Positions stay gapless. The server counts words itself (runs of
non-whitespace characters; CJK text counts differently from a dictionary). Titles follow the 4a
rules. Text is stored as sent, never cleaned (the web screen must show it as text). Every response
is `Cache-Control: private, no-store`; bodies are never logged. Cap: 1,000 documents per project.

## Test plan and edge cases

Access (401, 404 for foreign project or wrong-project path, owner-filter mutation check); create,
read and delete (defaults, children, renumbering, second delete, cascade from project); validation
(titles, text sizes 0 / 200,000 / 200,001, worst-case escaped body, 413, 415, NUL, lone surrogate,
unknown fields, empty PATCH, bad UUIDs); outline and moves (order, depth, cycles, foreign parent,
bad positions, gapless, cap); versions (missing, stale, malformed, weak, `*`, list; +1 per save;
a real two-request race gives one 200 and one 412); word count; project ordering; limits.

## Security and accessibility notes

OWASP A01 (owner in every query, ids must match), A03 (parameters), A04 (size, count and rate limits,
project-row lock), A05 (strict bodies, no-store), A09 (text never logged). No screen, so no WCAG
impact; error texts are plain sentences.

## Alternatives and risks

Left out: bulk move, fractional positions, soft delete, history, search, real-time merging. Risks:
the project-row lock serialises two tabs of one project (fine for one writer); deleting a chapter
deletes its scenes with no undo (4d must ask first); the migration touches a table with rows (the
default of 1 is safe); the word-count rule for CJK is a simplification.

## Outcome

Done as planned, with the deviations below.

- Tests: 212 new (76 unit, 136 integration). Whole API suites: 930 unit and 766 integration, all
  passing. Web unit tests 761 passing (untouched). Lint, typecheck and `bun audit` clean. Browser
  tests not run: nothing in `apps/web` changed.
- Mutation check: removing the owner filter from the project lock fails 3 tests, removing it from
  the single-document read fails 1, removing the version guard fails 4. The original file was
  restored byte for byte afterwards.
- Probes: a per-route `bodyLimit` above the global 1 MiB works (the 2.4 MB worst-case body is
  accepted, 2.7 MB gets 413). A lone surrogate is refused with 400 (`isWellFormed`) rather than
  tested against PostgreSQL, because the driver would replace it silently.

Deviations from the plan:

- **No separate 16 KiB body limit.** Both routes that take a body (`POST` and `PATCH`) can carry
  text, so they share the 2.5 MiB limit; `GET` and `DELETE` have no body. The constant was dropped.
- **`projects/schemas.ts`:** `characters`, `hasNoNul`, `unitCeiling` and `title` gained `export`
  (nothing else changed there).
- **`db/__tests__/test-support.integration.test.ts` (a test of an earlier PR):** it asserted exactly
  2 migrations in the history table, so any new migration broke it. It now compares with the number
  of entries in `drizzle/meta/_journal.json`. The meaning (the history survives a reset) is
  unchanged.
- **`routes/write-limit.ts`** is a new shared helper used by documents only; `routes/projects.ts`
  still has its own copy of the same code. Left alone on purpose (merged code); a follow-up could
  make projects use the helper.
- Generated files were formatted with Biome (`0002_snapshot.json`, `_journal.json`), as the earlier
  ones are.

Changes after a line-by-line review of the finished code (2026-11-10):

- `service.ts`: dropped a redundant type in `arrange`. `schemas.ts`: the length check on the text
  now aborts the others (`abort: true`), so a far too long text is not walked three more times.
- New tests: a 404 for a missing document in the person's own project leaves the project's place in
  the list alone (the rollback path of `leave`); a stale version beats a wrong parent (412, not 400);
  three simultaneous-request tests (eight creates, creates at the front with a delete, eight creates
  at 999 items) that fail without the project lock. Opening the pool's connections first
  (`openConnections`) is what makes them overlap: a first version of the cap test passed even with
  the lock removed, because new connections are slower than a whole create.
- Tightened tests: the "what is logged" test now really reaches a 400 (it was hidden behind the
  rate limit), a vacuous assertion and a weak one were replaced, and invisible characters in two test
  files are written as escapes.
- README: an accepted save always raises `version`, and `DELETE` needs no `If-Match`.

Left alone on purpose, for later: a lock timeout for writes that wait on the project lock; `DELETE`
without `If-Match` (revisit with the delete confirmation in 4d); an `ai_analyses` unlink test for
deleting a document (with the analysis PR). Lone surrogates in project titles and loglines (merged
4a code, also used for document titles) are not refused: a separate fix.

Not covered: the migration was applied only to empty test databases (`ADD COLUMN ... DEFAULT 1` on a
table with rows is standard PostgreSQL behaviour and was not tested separately); a lone surrogate in
a 4a project title or logline may have the same silent-replacement gap (not probed, not changed);
moving a sibling bumps its `updated_at` through the existing trigger, but not its `version`.
