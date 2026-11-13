# Plotpal

An app that helps writers of scripts and stories find plot holes and get ideas with AI.
Users sign up and sign in, and their work is stored in a database.

> Status: early development. See `.plans/` for the roadmap and per-step plans.

## Prerequisites

- Node.js >= 24 (LTS or newer)
- [bun](https://bun.sh) (package manager; the only lockfile is `bun.lock`)
- Docker (for the local PostgreSQL database)

## Setup

```sh
cp .env.example .env     # then change POSTGRES_PASSWORD (and both database URLs to match)
                         # and set JWT_ACCESS_SECRET (the command is in .env.example)
bun install
bun run db:up            # starts PostgreSQL 18 on 127.0.0.1:5432 and waits until it is healthy
bun run db:migrate       # creates the tables
```

If port 5432 is already taken on your machine, set `POSTGRES_PORT` and the port in both database
URLs in `.env`.

## Database

The schema lives in `apps/api/src/db/schema/` (one file per table) and the generated SQL migrations
in `apps/api/drizzle/`. After changing the schema, generate a migration and review the SQL:

```sh
bun run db:generate -- --name=describe_the_change
bun run db:migrate
```

Never edit a migration that has been merged; add a new one. Integration tests use the separate
`*_test` database from `TEST_DATABASE_URL` and refuse to run against any other name.

## Run

```sh
bun run --filter @plotpal/api dev    # API on http://127.0.0.1:3000  (GET /health)
bun run --filter @plotpal/web dev    # Web on http://127.0.0.1:5173
```

API reference (generated from the route schemas): http://127.0.0.1:3000/docs/. Every API error is
an RFC 9457 `application/problem+json` response.

## Auth

All under `/auth`; the full reference is at `/docs/`.

| Route                 | Needs                                                   | Gives                              |
| --------------------- | ------------------------------------------------------- | ---------------------------------- |
| `POST /auth/register` | `Origin`                                                | access token + cookies             |
| `POST /auth/login`    | `Origin`                                                | access token + cookies             |
| `POST /auth/refresh`  | `Origin`, `refresh_token` cookie, `X-CSRF-Token` header | new access token + rotated cookies |
| `POST /auth/logout`   | `Origin`, `refresh_token` cookie, `X-CSRF-Token` header | 204, cookies cleared               |
| `GET /auth/me`        | `Authorization: Bearer <access token>`                  | the signed-in user                 |

The access token lives in memory only. The refresh token is an `httpOnly`, `SameSite=Strict` cookie.
The web app copies the CSRF cookie into the `X-CSRF-Token` header.

| Cookie  | Development     | Production (`NODE_ENV=production`) |
| ------- | --------------- | ---------------------------------- |
| refresh | `refresh_token` | `__Host-refresh_token`             |
| CSRF    | `csrf_token`    | `__Host-csrf_token`                |

In production both names start with `__Host-`: browsers then accept the cookie only if it is
`Secure`, has `Path=/` and no `Domain`, and refuse one set by another host, so a sibling subdomain
cannot plant its own login cookies in a visitor's browser. Development uses the plain names (and
`Path=/auth` for the refresh cookie) because browsers refuse `Secure` cookies over plain http.

### Web app

Open **http://127.0.0.1:5173** (not `localhost`, see below). The screens:

| Address               | Screen                                          | Who sees it                      |
| --------------------- | ----------------------------------------------- | -------------------------------- |
| `/`                   | Landing page                                    | everyone                         |
| `/register`, `/login` | Sign-up and login forms                         | signed-out; others are sent on   |
| `/app`                | Your projects: a form for a new one, and a list | signed-in; others go to `/login` |
| `/app/projects/:id`   | The writing screen of one project               | signed-in; others go to `/login` |
| anything else         | Page not found                                  | everyone                         |

The projects list loads 20 at a time with a "Load more projects" button. A new or changed project
is shown at the top at once (the list is sorted by last change). What a person wrote (titles,
loglines) is always shown as text, never as markup.

Each project has **Edit** and **Delete**. Edit turns the card into a form with the project's values;
Save sends only what changed, and saving with no change asks the API for nothing. Delete asks first,
naming the project and saying that its documents and analyses go too and that it cannot be undone;
the question opens with the focus on "Keep project", and Escape keeps the project. The projects API
has no version check, so if two tabs change the same project the last save wins. A project's title
opens its writing screen.

### The writing screen

`/app/projects/<project id>?document=<document id>`: the project's outline (acts, chapters and the
scenes inside them) beside the text of the open item. The open item is in the query string, so Back
works and a link leads straight to a scene; choosing or adding an item moves the focus into its text.
"Add to the outline" adds an act or chapter at the top level, or a scene inside the open act (one
level of nesting).

- **The text is a plain box**, kept exactly as typed (spaces, line breaks, emoji, any language). The
  box itself holds the text, not React, so a very long text (up to 200,000 characters) does not
  re-render on every key.
- **It saves by itself** 2 seconds after the last keystroke, when the box or the document is left,
  and at once with Ctrl or Cmd + S. The status line says "Saved", "Unsaved changes" or "Saving…". Text
  typed through an input method (Chinese, Japanese, Korean) is saved after the character is finished.
- **A failed save is retried** after 5, 10, 20, 40 and then every 60 seconds (or as long as the
  server says after "too many requests"); the text stays in the box and the status line says why.
  Text the API refuses (such as one with a broken character) is explained and kept.
- **Each save says which version it started from** (`If-Match`). If another tab or device saved a
  newer version first (412), nothing is overwritten: the writer's text stays on screen and a notice
  offers "Save my text over theirs" or "Load the newer text (discard mine)".
- **Closing the tab with unsaved text asks first.** A tab closed within two seconds of the last
  keystroke, without that prompt being answered, can still lose those last words (a closing page
  cannot send a request that large).
- **The open item can be renamed, moved and deleted** from a group of buttons above its text:
  Rename, Move up, Move down, Move to… and Delete. Moving needs no dragging. "Move to…" is a list of
  places (the top level, or inside an act or chapter), and the item goes to the end of the place
  chosen; Move up and Move down place it exactly. An item that has scenes of its own cannot go inside
  another item (the outline has one level), so it gets no "Move to…". A button that cannot do
  anything now (the first item cannot go up) stays in place and stays focusable, marked unavailable,
  so the focus never jumps. After a rename or a move the outline is read again from the server, and
  the change is announced to screen readers. Delete asks first, names the item and how many scenes go
  with it, and has "Keep item" focused; afterwards the item closes and the focus goes to the outline.
- **A rename or a move takes its turn with the text saves.** It saves the pending text first, and
  keeps the new version the server returns, so the writer's next text save does not conflict with
  their own rename. Every accepted change raises the item's `version`, so another tab that has the
  same item open gets the "changed somewhere else" notice on its next save (its text is safe, and
  "Save my text over theirs" keeps the new title).

After a login the person returns to the private page that sent them to the login. That address is
checked by resolving it (`lib/navigation/safe-return-path.ts`), so `//evil.example`, `/\evil.example`
and the like are ignored and the person lands on `/app`.

Rules for the web app, and how it follows them:

- **One origin.** The API must be reached from the same host as the page, behind a reverse proxy.
  The page can only read the CSRF cookie of its own host, and a `SameSite=Strict` cookie is not
  sent between `localhost` and `127.0.0.1`. Never loosen the cookie to `SameSite=None` or add a
  `Domain` to work around this. In development the Vite server is that proxy: it forwards `/auth`
  and `/projects` to the API (`API_URL`, default `http://127.0.0.1:3000`), so open the page at
  **http://127.0.0.1:5173**, not `localhost`. Each new API area is added to the list in
  `apps/web/src/lib/dev-proxy.ts`, and the same list becomes the reverse-proxy rule in
  production. Because of this, `/auth` and `/projects` and everything below them (`/auth/...`,
  `/projects/...`) are reserved: no page may use those addresses (the writer's own screens will
  live under `/app`). Names that only start the same way (`/authors`, `/auth-callback`,
  `/projects-old`) stay pages.
- **`vite preview` needs its own origin allowed.** It serves the production build on
  `http://127.0.0.1:4173`, which is not in the default `CORS_ORIGINS` (the API refuses the `Origin`
  of every sign-in with a 403). Add it to `CORS_ORIGINS` in `.env` to use the preview. A
  production build also reads only the `__Host-` cookie, which exists only when the API runs with
  `NODE_ENV=production` over https, so a preview against a development API cannot restore a login.
- **Keep the path.** The proxy forwards paths unchanged. Do not mount the API under a prefix such
  as `/api`: the development refresh cookie is limited to `Path=/auth`.
- **A 401 from `/auth/refresh` is not always "signed out".** A tab that loses a refresh race gets a
  401 although another tab just renewed the login. `lib/auth/session-manager.ts` waits 300 ms and
  retries once (re-reading the cookie) before it signs out. This relies on the API's refresh reuse
  grace (`REFRESH_REUSE_GRACE_SECONDS`, default 10): with `0` the API treats the loser of a normal
  two-tab race as a thief and revokes the whole login, so never set it below a few seconds.
- **No body on refresh and logout.** `lib/api/auth-api.ts` sends `POST /auth/refresh` and
  `/auth/logout` with no body and no content type.
- **The access token lives in a variable** (`lib/auth/token-store.ts`), never in `localStorage`,
  `sessionStorage` or IndexedDB. A page reload restores it from the refresh cookie. The session
  manager renews it a minute before it expires (and tries again after 5, 10, 20, 40 and then every
  60 seconds if that fails because the network or server is down), and `withAuth` renews it once
  and retries once when a call gets a 401. **Every call that needs the token must go through
  `withAuth`**, otherwise a token that expired while the laptop slept is sent as it is.
- **Signing out reaches every tab.** The tab that signs out sends the word `signed-out` (nothing
  else, never a token) over a `BroadcastChannel`, and the other tabs of the browser end their
  login at once instead of working on until their own token expires. A tab never refreshes after
  its own sign-out, even if a call fails with a 401 while the logout request is still travelling.
- **The CSRF code** is read from `csrf_token` in development and from `__Host-csrf_token` in a
  production build, never both (`lib/auth/csrf-cookie.ts`): another host can plant a plain cookie
  but not a `__Host-` one. It is copied into `X-CSRF-Token`. Its absence means "not signed in":
  no refresh request is sent.
- **Requests are fenced in** (`lib/api/http.ts`): a path that would leave the page's own origin is
  refused, a request that is not answered within 15 seconds is given up as a network error, and a
  redirect is never followed, so a misbehaving proxy cannot hand the token or the CSRF code to
  another host. Text from the server is cut and cleaned before the app sees it (`lib/api/problem.ts`).

## Projects

All under `/projects`, all need `Authorization: Bearer <access token>`; the full reference is at
`/docs/`. A person only ever reaches their own projects: someone else's project is answered with
404, exactly like one that does not exist.

| Route                  | Gives                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `GET /projects`        | `{ items, nextCursor }`, newest updated first (`?limit=` 1 to 100, default 20; `?cursor=` is the previous `nextCursor`)         |
| `POST /projects`       | 201 and the new project (`title` 1 to 200 characters, `format` `screenplay`, `prose` or `other`, optional `logline` up to 1000) |
| `GET /projects/:id`    | the project                                                                                                                     |
| `PATCH /projects/:id`  | the changed project (send only what changes; `logline: null` clears it)                                                         |
| `DELETE /projects/:id` | 204. Permanent: the project's documents and analyses are deleted with it                                                        |

Creating, changing and deleting share a limit of 60 per minute per person.

Titles and loglines (and the titles of documents) are stored exactly as sent, apart from the spaces
at both ends, which are removed. A NUL character or a broken emoji (a lone surrogate half) is refused
with 400, because the database cannot store it and would silently write U+FFFD in its place.

## Documents

The outline (acts, chapters, scenes) and the text of one project. All under
`/projects/:projectId/documents`, all need `Authorization: Bearer <access token>`; the full reference
is at `/docs/`. A project or document of someone else, or a document reached through the wrong
project, is answered with 404, exactly like one that does not exist. Every answer is
`Cache-Control: private, no-store`.

| Route                    | Gives                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `GET …/documents`        | `{ items }`: the whole outline without text, each act followed by its scenes (not paginated) |
| `POST …/documents`       | 201 and the new item (`title` 1 to 200; optional `parentId`, `position`, `content`)          |
| `GET …/documents/:id`    | the item with its text, `version`, and the same version as `ETag`                            |
| `PATCH …/documents/:id`  | the changed item. Send only what changes. **Needs `If-Match`**                               |
| `DELETE …/documents/:id` | 204. Permanent: the children of an act or chapter are deleted with it                        |

- **Saving needs the version you read.** Send the `ETag` of the `GET` (or of the last save) as
  `If-Match`. Missing: 428. Malformed (`*`, a list, no quotes): 400. Out of date, because another
  tab saved first: 412, so load the item again instead of overwriting. The weak form `W/"3"` is
  accepted on purpose, because proxies that compress answers turn strong tags weak. A move of
  other items (renumbering the siblings) does not change an item's own `version`. Every accepted
  save of the item itself raises its `version`, even when the values sent equal the stored ones.
  `DELETE` needs no `If-Match`: it removes the item whatever its version.
- **Shape.** One level of nesting: an item under an act or chapter cannot hold items itself, and an
  item that has children cannot be moved under another. `position` counts from 0 among the
  siblings, without gaps; leaving it out appends. A position past the end is 400. `parentId: null`
  moves to the top level. On a move, `position` is counted without the item itself.
- **Text.** Up to 200,000 characters (an emoji is one), stored exactly as sent: never trimmed or
  cleaned, so the web screen must show it as text, never as HTML. A NUL character or a broken
  emoji (a lone surrogate half) is refused with 400. `wordCount` is counted by the server as runs
  of non-space characters; Chinese, Japanese and Thai, written without spaces, count as one word per
  run.
- **Sizes.** At most 1,000 items per project (the 1,001st is 409). Create and `PATCH` accept bodies
  up to 2.5 MiB (200,000 emoji written as JSON escapes are 2.4 MB); larger is 413.
- **Changes are serialised per project.** Every create, save, move and delete first locks the
  project, so one change at a time runs per project, and it also moves the project to the top of
  `GET /projects`. Two tabs of one writer therefore queue instead of racing. A change that has to
  wait more than five seconds for that lock gives up: **503** with `Retry-After: 2` and nothing
  changed, so the request can simply be sent again. (A waiting change holds a database connection,
  so without the limit a pile-up on one project could use up all of them.) The web screen already
  words a 503 and retries saves by itself. Reads never wait for the lock.
- Creating, saving, moving and deleting share a limit of 120 per minute per person, separate from
  the projects limit.

## AI analyses

A plot-hole scan (`kind: plot_holes`) or a list of ideas (`kind: ideas`) for one item (an act with
its scenes, or a scene) or for the whole project, made by Claude. All under `/projects/:projectId/analyses`, all
need `Authorization: Bearer <access token>`; the full reference is at `/docs/`. A project or run of
someone else is answered with 404, exactly like one that does not exist. Every answer is
`Cache-Control: private, no-store`.

| Route                        | Gives                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET …/analyses/estimate`    | What a run would use and cost, what is left of your allowance, and whether runs can start at all                                                                          |
| `POST …/analyses`            | **202** and the run as `pending`. Body: `{ "kind": "plot_holes", "scope": "project" }`, or `"scope": "document"` with a `documentId`; `"kind": "ideas"` can add a `focus` |
| `GET …/analyses`             | Your runs on this project, newest first, with cursor paging like the project list                                                                                         |
| `GET …/analyses/:id`         | One run: `pending`, or `succeeded` with its `result`, or `failed` with an `errorCode`                                                                                     |
| `POST …/analyses/:id/cancel` | Stops a run in progress (it ends as `failed`, `canceled`)                                                                                                                 |
| `DELETE …/analyses/:id`      | 204. Permanent. A run still going is stopped first                                                                                                                        |

- **A run goes on in the background.** `POST` answers at once; the screen asks `GET` every few
  seconds until the run is `succeeded` or `failed`. A run that the server was restarted under is
  marked `failed` with `interrupted` when the server starts again (the runs live inside one API
  process; with a second process a lease would be needed first).
- **The answer is checked.** The model must answer in a fixed shape (findings with a severity, a
  category, an explanation, evidence and a suggestion); an answer that does not match is a failed
  run, never shown. Each quote in the evidence is looked up in the real text, so the result says
  `verified` for a quote that is really there and `false` for one that may have been invented.
- **Why a run can fail** (`errorCode`): `refused` (the safety systems declined, also after the
  automatic retry on another model), `truncated`, `invalid_output`, `rate_limited`, `overloaded`,
  `timeout`, `too_long`, `not_configured` (the server's key is not working), `canceled`,
  `interrupted`, `internal`. Tokens are recorded whenever the model got as far as answering.
- **Limits.** One run at a time per person (409). Per person over the last 24 hours: at most
  `AI_USER_DAILY_RUNS` runs and `AI_USER_DAILY_TOKENS` tokens (429 with `Retry-After`, counting
  failed and cancelled runs too). Everybody together: `AI_GLOBAL_DAILY_TOKENS` tokens (503 with
  `Retry-After`), the cap on the bill. A text longer than `AI_MAX_INPUT_TOKENS` is refused up front
  (413) with a hint to choose a smaller part; no text at all is 422. Starting, cancelling and
  deleting runs has a limit of 20 per minute per person, separate from the other counters.
- **Ideas.** An idea run answers with a summary and at most eight ideas, best first: a title, a kind
  (`plot_twist`, `scene`, `character`, `conflict`, `dialogue`, `theme`, `other`), a description, why it
  fits (what the story already has that it builds on), one to three quotes from the text (checked
  like the quotes of a finding) and the item it could go into (`goesIn`, `null` for the story as a
  whole). It brainstorms: it does not write the scene. The optional `focus` says what the ideas
  should be about, up to 500 characters; it is turned into one plain line (line breaks, control and
  invisible direction characters become spaces or are dropped), stored with the run (`focus`, `null`
  when none) and sent in the task between two marker lines that say it cannot change the rules. A
  focus for a plot-hole scan is a 400. Both kinds share the one-run-at-a-time rule and the daily
  allowance, and the same standing instructions and manuscript, so the prompt cache is reused.
  The focus is never written to the log.
- **The cost hint** (`/estimate`) is worked out from the number of characters, with no call to the
  AI service: a range of tokens and of dollars at the configured model's published price. It is a
  rough estimate, not a quote.
- **Settings** (in `.env`, see `.env.example`): `ANTHROPIC_API_KEY` (optional: without it the AI
  features are off and everything else works), `AI_ENABLED` (a kill switch), `AI_MODEL` (the plain
  model name, `claude-opus-5-5` by default, about $0.30 for a 100-page screenplay; `claude-sonnet-5-5`
  is about half), `AI_EFFORT`, `AI_MAX_INPUT_TOKENS`, `AI_MAX_OUTPUT_TOKENS`, the three limits above
  and `AI_REQUEST_TIMEOUT_SECONDS`. The key is only ever read by the server, never logged, and never
  sent to the web app.
- **Privacy.** Starting a run sends the text of the chosen items to Anthropic's Claude API. Anthropic's
  data retention terms for your account apply, and the web screen says so before every run. The
  manuscript, the prompt and the result are never written to the server's log (a failure is logged
  with names and codes only).
- **Prompt injection.** The manuscript is sent as data: every item sits behind a header line made
  from a hash of the whole text (so nobody can write it into their text in advance), the
  instructions say that only the task after the manuscript is an instruction, and the model has no
  tools and no way to do anything, so a text that tries to give it orders can only spoil its own
  result. The result is validated and shown as text, never as HTML.
- **Refusals.** A manuscript with dark themes can trip the model's safety systems. The request asks
  for the server-side fallback, which retries a declined request on another model inside the same
  call; a refusal that remains is a failed run with `refused`.
- **The fake model.** `buildApp` takes the model call as a dependency (`aiClient`), which only
  test code uses: tests and the browser tests pass a fake that makes no network call and costs
  nothing. There is no setting that switches the fake on in a running server. The end-to-end API
  (`e2e-server.ts`) uses it and has two test-only routes, `POST /__e2e/ai/next` and
  `POST /__e2e/ai/release`, that tell the fake what to answer next or to hold a run until released.

### The panel on the writing screen

Under the outline and the text there is a collapsed "AI assistant" section (a heading with one
disclosure button). Nothing is loaded until it is first opened.

- **Choosing and running.** A radio group asks "What do you want?": "Find plot holes" or "Get
  ideas". It is locked while a run goes, and a run found going when the page opens decides what the
  panel shows. The writer then picks the open item or the whole project, sees the size, the price
  range and what is left of the day's allowance (`/estimate`, no AI call, shared by both kinds), and
  presses "Run the scan" or "Get ideas". The privacy notice is in the page next to the button every
  time and is the button's accessible description; for ideas it also says that the focus is sent and
  saved. A text that is too long for one run disables the button and says why.
- **The focus (ideas only).** An optional free text, "What should the ideas be about?", at most 500
  characters, counted the way the server counts (spaces tidied, an emoji is one character: the rules
  are copied in `apps/web/src/lib/analyses/focus.ts`, with the API's own test cases). The count is in
  the field's hint, so it does not chatter on every key; over the limit there is an error tied to the
  field, said once to a screen reader, and Run is disabled. The text stays after a run, so that it
  can be adjusted. It is sent cleaned up and never with a plot-hole scan.
- **Watching a run.** The screen asks `GET …/analyses/:id` every 2 seconds (4 seconds after the
  first 15 asks, slower after answers that did not come, up to 10 seconds). It says so after three
  failed asks, keeps trying, and gives up after 30 with a hint to reload. The run is not tied to the
  page: after a reload the panel finds a run that is still `pending` in the history and watches it
  again. Cancel stops it. A run that is already going in another project (the API allows one per
  person) is explained, not shown as an error.
- **Results.** A plot-hole scan shows a summary, a count by severity, and one card per finding:
  severity and kind in words (never only colour), the explanation, each quoted passage marked "Found
  in your text" or "Not found in your text" (a quote the AI may have invented), a link to the item a
  passage is in, and a way to fix it. An idea run shows the focus that was asked for, a summary and
  one card per idea: the kind in words (plot twist, scene, character, conflict, dialogue, theme), the
  description, "Why it fits", the same marked quotes, and "Could go in" as a link when that item is
  still in the outline. The quote part is one shared component (`EvidenceList`). All of it is plain
  text. A run that did not finish says why in plain words per `errorCode`.
- **History.** The last ten results of both kinds (with "Show older results"), each named for its
  kind ("Plot holes" or "Ideas"), openable (the focus moves to its result) and deletable behind a
  confirmation that keeps the safe answer focused.
- **Where the code is.** `apps/web/src/lib/api/analyses-api.ts` (the calls; a run is a union by
  `kind`, so a plot-hole result under the kind `ideas` is refused), `apps/web/src/lib/analyses/` (the
  hook, the wording of every error, the cost text, the focus rules) and
  `apps/web/src/components/organisms/AiPanel/`.

## Checks

```sh
bun run lint
bun run typecheck
bun run test               # unit tests, no database needed
bun run test:integration   # needs the database from `bun run db:up`
bun run --filter @plotpal/web test:e2e   # browser tests, see below
```

### End-to-end tests (Playwright)

`bun run --filter @plotpal/web test:e2e` (or `bunx playwright test` in `apps/web`) drives a real browser (Chromium and WebKit, the Safari engine) through the built
web app and a real API. It is not part of `bun run test`: it is slower and needs the database.

- **First time:** `cd apps/web && bunx playwright install chromium webkit` downloads the browsers
  (a few hundred MB, once). The database must be running (`bun run db:up`).
- **What it starts:** an API on `127.0.0.1:3100` and the web app on `127.0.0.1:4173`, never reusing
  a running server, so your development servers (3000 and 5173) are left alone. The API is
  `apps/api/src/test-support/e2e-server.ts`: it drops and rebuilds a throwaway database
  `plotpal_e2e_test` on the server named by `TEST_DATABASE_URL`, listens on loopback only, and
  relaxes only the per-address sign-up and login limits. It refuses `NODE_ENV=production`.
- **What it covers:** the full sign-up, reload, sign-out and login journeys; the cookie flags
  through the dev proxy; no token in browser storage; axe (accessibility) in light and dark mode
  with colour contrast; 320 px reflow; target size; keyboard and focus order.
- **Limits:** the web app is built with `NODE_ENV=development` for the run, because the API sets the
  plain cookie name `csrf_token` over http and a production build reads only `__Host-csrf_token`.
  The production cookie names and flags (`__Host-`, `Secure`) need https and are not covered.
  WebKit does not Tab to links (the Safari default), so link tab stops are checked in Chromium only.
  On GitHub these run for every pull request (see "Continuous integration" below); run them yourself
  before a PR that touches the web app, so that a red run is a surprise.
- **Sign-out followed by a login:** a sign-out answer deletes the login cookies whenever it
  arrives, so the web app sends a login or sign-up only after the sign-out request of the same tab
  has finished (`sign-out-race.e2e.ts` proves the order). Not covered: a sign-out in one tab and a
  login in another tab at the same moment.
- Reports and traces go to `apps/web/playwright-report/` and `apps/web/test-results/` (ignored by
  git). A trace can contain typed passwords and cookies: the tests use made-up accounts only, but
  do not share the folders.

## Layout

```
apps/api   Fastify backend (TypeScript, Zod-validated env config, Drizzle + PostgreSQL)
apps/web   React + Vite frontend (Atomic Design under src/components)
.plans/    Dated plans with a status header (draft / approved / done)
```

## Continuous integration

GitHub Actions runs on every pull request and every push to `main` (`.github/workflows/`):

| Workflow / job                            | What it runs                                                 | In the merge gate                  |
| ----------------------------------------- | ------------------------------------------------------------ | ---------------------------------- |
| `CI` / `Lint, types and unit tests`       | `bun run lint`, `typecheck`, `test`                          | yes                                |
| `CI` / `Integration tests (PostgreSQL)`   | `bun run test:integration` against a PostgreSQL 18 container | yes                                |
| `CI` / `Browser tests` (Chromium, WebKit) | the Playwright tests, one job per browser                    | not yet (known flaky WebKit tests) |
| `Dependency audit`                        | `bun audit`, also every Monday                               | no                                 |

The `CI` job at the end of `ci.yml` is the one name to require before merging: it fails when any job it
waits for failed, was cancelled or was skipped. A failed browser run uploads its report as an artifact
for seven days (Actions tab, the run, "Artifacts"); open it with `bunx playwright show-report`.

Details worth knowing: every action is pinned to a full commit hash, the workflows have read-only
rights and use no secrets (the AI tests use the fake model), the database in CI is a throwaway container
whose password is in the workflow on purpose, and the browser tests get a signing secret made for that
run only. The local action `.github/actions/setup` installs Bun, Node and the locked dependencies for
every job, and the install fails when `package.json` and `bun.lock` disagree.
