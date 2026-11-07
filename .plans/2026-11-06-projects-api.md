Status: done (2026-11-06). Decisions taken as recommended: roadmap of four PRs accepted; other
people's projects answer 404 (never 403); list pages default to 20 and are capped at 100; a
project's `format` can be changed after creation; the unfinished sign-out fix was parked with
`git stash` (stash message "sign-out login race fix") so this branch starts from a clean `main`.

# Step 4, PR 4a: projects API

## Goal

A signed-in writer can list, create, read, edit and delete their own projects through the API, and
nobody can see or change anyone else's. This is the first of four PRs of Step 4; each later one
gets its own plan.

| PR  | What                                                                                              |
| --- | ------------------------------------------------------------------------------------------------- |
| 4a  | Projects API (this plan)                                                                          |
| 4b  | Documents API: outline and saving the text (version check with `If-Match`, body size, word count) |
| 4c  | Web: the "Your projects" screen (replaces the `/app` placeholder)                                 |
| 4d  | Web: the writing screen (outline, editor, autosave); the editor type is decided there             |

Storybook is optional and not needed for any of them.

## Tech choices

No new dependency. Fastify routes with Zod schemas (as in `routes/auth.ts`), Drizzle on the existing
`projects` table and its index `(user_id, updated_at desc, id desc)` (no migration), the existing
`requireAuth` (Bearer token), RFC 9457 Problem Details errors, cursor (keyset) pagination, OpenAPI
through the route schemas with a new `projects` tag, Vitest unit and integration tests on the real
test database.

## Files (all in `apps/api/src/` unless noted)

New: `projects/schemas.ts`, `projects/cursor.ts`, `projects/service.ts`, `routes/projects.ts` and
their tests in `__tests__/`.
Modified: `app.ts` (register the routes), `plugins/openapi.ts` (tag), `apps/web/src/lib/dev-proxy.ts`
and its test (forward `/projects`), `README.md` (routes table), this plan.

Routes (all need `Authorization: Bearer`): `GET /projects?limit=&cursor=` (`{ items, nextCursor }`,
newest updated first, default 20, max 100), `POST /projects` (201), `GET /projects/:id`,
`PATCH /projects/:id`, `DELETE /projects/:id` (204, permanent, cascades to documents and analyses).

## Test plan and edge cases

- Access: no or bad token gives 401 on every route; another person's project gives 404 on get,
  patch and delete; lists never contain other people's projects; `userId`, `id`, `createdAt` in a
  body are refused; the response never contains `userId`.
- Input: title empty, spaces only, 1, 200, 201 characters, emoji and accents (counted as code
  points like the database), trimmed; logline missing, `null` clears, 1000 and 1001; format valid,
  invalid, wrong case; PATCH with no fields or only unknown fields; `:id` not a UUID (400), unknown
  UUID (404), deleting twice (second is 404); not JSON (415), too large (413), wrong types (400).
- Paging: empty list, under one page, exactly one page (`nextCursor` null), one more than a page,
  equal `updated_at` values (id breaks the tie), an edited project moves to the top, a project added
  while paging causes no repeats or gaps, `limit` 0, 101, `abc`, negative, decimal (400), cursor
  garbage, truncated or edited (400).
- Other: deleting a project removes its documents and analyses and nothing else; OpenAPI lists the
  five routes; existing suites stay green.

## Security and accessibility notes

OWASP A01 broken access control is the main risk: every query filters by owner. A03: Drizzle
parameters. A04/A05: unknown fields refused, body limit and headers unchanged. A07: Bearer tokens
are not sent by browsers by themselves, so no cross-site request forgery. A09: request bodies are
not logged (titles are user text). Write routes get a per-user rate limit; pages are capped at 100.
No screen in this PR, so no WCAG impact; error texts are plain sentences for later screens.

## Alternatives and risks

Offset paging, 403 for foreign projects, a total count, search and sorting options, and soft delete
were considered and left out (see the chat plan of 2026-11-06). Risks: deleting a project cascades
to `ai_analyses` (tested); the big decisions (concurrent saves, body size, editor type) belong to 4b
and 4d; the dev servers were stopped for low memory and are not needed by the tests.

## Outcome

Done as planned. The five routes exist; every query is filtered by the owner; writes share a limit
of 60 per minute per person (`projects/limits.ts`). `/projects` is also forwarded by the web dev
proxy and reserved in the README.

- Tests: API unit 692 -> 854 (cursor, schemas), API integration 649 (202 new in five
  `projects-*.integration.test.ts` files: access, create/read/change/delete, validation, paging,
  limits), web 714 -> 732 (proxy). Lint, typecheck and `bun audit` clean. Browser suite: 169
  passed, 1 skipped, plus the known finding-2 test as an expected failure (this branch is based on
  `main`, where that fix is still parked in `git stash`).
- With the owner filter removed from the service, 5 access tests fail, so they do catch a broken
  access check.
- Found by the tests and fixed in the code: (1) the plugin's `isAllowed` is true only for
  allow-listed callers, so the first version of the write limit refused every write (now it checks
  `isExceeded`); (2) with the route path `"/"` the API reference listed `/projects/` with a slash
  (now the empty path, so only `/projects` exists).
- Design points worth remembering for 4b: the cursor carries the database's own timestamp text
  (microseconds), because a JavaScript `Date` keeps only milliseconds and would repeat or skip
  projects; NUL characters are refused with 400 (PostgreSQL cannot store them); the 16 KiB body
  limit still fits the largest valid project even when written as escape pairs.
- Changed on purpose: the old proxy test "forwards only /auth" now says `/auth` and `/projects`.
- Known and open: the two WebKit flakes noted in `2026-11-05-sign-out-login-race.md` (the sign-out
  fix itself is not part of this branch). Not added: a total count, search or sorting, trash.
