Status: approved (2026-11-14); PRs 5a (#24), 5b (#25) and the link fix (#26) merged; PR 5c-1 (ideas API) merged (#27); PR 5c-2 (ideas in the web panel) built, pending review and merge. Decisions taken as recommended ("a for all"): 1-A the model is
`claude-opus-5-5` (about $0.30 a run, set by `AI_MODEL`); 2-A a background run with polling; 3-A limits of
10 runs and 1,000,000 tokens per person per day and 5,000,000 tokens per day for everyone; 4-A the first
release offers the open item and the whole project; 5-A the privacy notice is shown with the Run button
every time and nothing is stored; 6-A three PRs: 5a the API and the plot-hole finder, 5b the web panel,
5c the idea generator. The server-side refusal fallback is included by default.

# Step 5: the AI features (plot-hole finder, idea generator)

## Goal

A signed-in writer can ask for a plot-hole scan (later: ideas) on the open item or the whole project,
sees what it will cost first, and gets a structured result with quotes that point back into their text.
Done means: tested without calling the real API, lint, typecheck and `bun audit` clean, browser tests
green, limits enforced, nothing private logged, the panel usable by keyboard and screen reader.

## Tech choices

The official `@anthropic-ai/sdk` (the one new dependency; the key only in the server environment). One
request per run (no agent, no tools). Model `claude-opus-5-5`, adaptive thinking, `effort: "high"` set
explicitly (this model defaults to `medium`), streaming on the server, Zod schemas through
`output_config.format` for a checked structured answer, prompt caching (the manuscript is the stable
front of the prompt), and the server-side refusal fallback (`fallbacks: "default"`). A background run
with polling (no queue software); a start-up sweep fails runs a restart left `pending`. The Claude call
sits behind an `AiClient` interface with a fake for tests; no environment setting can switch the fake on.

## PR 5a: API foundation and plot-hole finder (`feat/ai-plot-holes-api`)

Config (`ANTHROPIC_API_KEY` optional, `AI_ENABLED`, `AI_MODEL`, `AI_EFFORT`, the limits); migration
`0003` with a partial unique index (one `pending` run per person, enforced by the database);
`ai/{limits,pricing,estimate,schemas,manuscript,quote-check,client,anthropic-client,fake-client,service}.ts`,
`ai/prompts/plot-holes.ts`; `routes/analyses.ts` with `GET .../estimate`, `POST` (202), `GET` list (cursor
paging), `GET :id`, `POST :id/cancel`, `DELETE :id`; tests; README.

## PR 5b: the web panel (`feat/ai-panel`); PR 5c: the idea generator (`feat/ai-ideas`)

As in the plan shown on 2026-11-14: a collapsible `AiPanel` on the writing screen with a cost hint, the
privacy notice, results with links into the text, and the run history; then the idea prompt, schema and
a "focus" field.

## PR 5c: the idea generator (approved 2026-11-12: "a for all")

Decisions: 1-A one panel with a mode choice ("Find plot holes" / "Get ideas"), shared scope, cost hint and
privacy notice, the heading becomes "AI assistant", the history labels the kind; 2-A an optional focus
field (free text, at most 500 characters, stored with the run); 3-A one shared daily allowance for both
kinds; 4-A two PRs: **5c-1** the API (`feat/ai-ideas-api`) and **5c-2** the web (`feat/ai-ideas-web`).

Shape of an answer: `summary`, and at most 8 `ideas`, best first. Each idea: `title`, `kind` (`plot_twist`,
`scene`, `character`, `conflict`, `dialogue`, `theme`, `other`), `description`, `whyItFits`, one to three
evidence quotes (verified against the text like findings) and the item it could go in. It brainstorms; it
does not write the scene and must not contradict what the text establishes.

API: migration `0004` adds `ai_analyses.focus` (nullable text, at most 500 characters; the kind `ideas` is
already allowed by the table's check); `ai/prompts/ideas.ts`; `schemas.ts` gets the ideas schemas, `ideas`
among the kinds, `focus` in the create body (400 for a plot-hole run) and `kind` in the estimate query;
the stored and returned analysis becomes a union by `kind`; the service picks prompt, answer schema and
checking by kind; the fake model answers a believable ideas result. The system prompt and manuscript stay
identical across kinds so the cache keeps working. The focus is length-capped, stripped of control
characters, delimited, and never logged.

## Test plan and edge cases

Prompt assembly (order, delimiters, hostile text, 1,000 items, empty project); the runner against the
fake (success, refusal, cut-off at `max_tokens`, answer not matching the schema, timeout, 429 and 529,
cancel, restart sweep, two runs at once, daily and global caps, input too long); ownership (404 for
others); the estimate; the quote check (real quote verified, invented one not); logs never hold the
manuscript, the prompt, the result or the key; the real adapter against a fake SDK object (request
shape and error mapping, no network). One optional live smoke test that you run by hand with your own
key; it is never part of the suite.

## Security and accessibility notes

OWASP A01 (owner filters, 404 for others), A02 and A05 (the key only in the server environment; a missing
key switches AI off), A03 and prompt injection (the manuscript is data between a per-run random
delimiter, the model has no tools, the answer is validated and shown as text), A04 (one run at a time,
input cap, per-person and global daily caps, a kill switch), A09 (nothing private logged), A10 (no URL is
fetched). The text is sent to Anthropic, and the panel says so before every run. Panel: a labelled
`aside`, a disclosure button, status messages, a real list of results, a real Cancel button.

## Alternatives and risks

Rejected: the Batch API (up to 24 hours), managed agents or tool use, streaming to the browser (SSE
later), a queue such as Redis. Risks: unknown result quality (an optional eval later; model and effort
are config), a run lost in a restart (the sweep fails it visibly), cost surprises (estimate, caps and
kill switch), refusals on dark material (the fallback and a kind message), a manuscript larger than the
limit (refused up front; chunking later). The one-instance assumption: the start-up sweep fails every
`pending` run, which is right while there is one API process (a lease is needed before there are two).

## Outcome of PR 5a (the API and the plot-hole finder)

Done as planned, with the additions below. The web app is untouched.

- Tests: API unit 945 -> 1113 (168 new), API integration 794 -> 921 (127 new); lint, typecheck and
  `bun audit` clean (one new dependency, `@anthropic-ai/sdk` 1.8.0, pinned). The 121 tests of the three
  analysis files passed five runs in a row. Nothing in the suite calls the real API.
- Mutation check, 15 real breaks, all caught (one placeholder was skipped): a quote always called
  verified; no ownership check on start; the daily run limit off by one; no global budget; a late
  answer overwriting a cancelled run; a second pending run not turned into 409; a two-day window;
  shutdown not stopping runs; a failure logged with its message; cached input not counted; a timeout
  reported as a cancel; no cache mark on the manuscript; no refusal fallback; a refusal read as an answer;
  a marker that no longer depends on the text. One survived the first time (the late answer): my fake
  stopped at every abort, so a call that cannot be stopped was never tested; the fake now has
  `ignoreAbort`.
- Found by the tests: closing the app waited for a held run (with a 10-minute timeout, a shutdown could
  hang for that long). `shutdown()` now stops every run at once and writes it down as `interrupted`.
  A second finding: the new database rule (one pending run per person) correctly broke five older tests
  that inserted several pending analyses for one person; they now insert finished ones.
- Added to the plan: a migration `0003` (a partial unique index, so "one run at a time" is enforced by
  the database and two simultaneous requests cannot both get through); a `DELETE` and a cancel route;
  the `aiSweepOnStart` and `shutdown` pieces; the OpenAPI tag; README section. I also applied
  migration `0003` to the development database with `bun run db:migrate` (it only adds the index).
- Live smoke test (2026-11-12, after the merge, with the owner's key and approval): one real call
  through the merged adapter on a two-scene story with a planted contradiction. Outcome `ok` in 14 s;
  the answer matched the schema; the planted hole and one real extra were found; 7 of 7 quotes
  verified; 396 input, 1,670 cache-written and 1,253 output tokens, about 3 cents (the estimate for
  that size said $0.09 to $0.33, so it is cautious for tiny texts). Not covered by it: a large
  manuscript, a second run reading the cache, and a refusal.
- Known and open: no streaming to the browser (the screen polls); the one-process assumption of the
  start-up sweep; a text over the input limit is refused rather than split; the result quality is
  unmeasured (an eval is a later option); model, effort and limits are config, not code.

## Outcome of PR 5b (the web panel, `feat/ai-panel`)

Done as planned: a collapsible "Plot-hole finder" section under the outline and text (decision taken:
under the panes, collapsed by default), with a scope choice, the cost hint, the privacy notice as the
Run button's description, progress with elapsed time, Cancel, results with links into the text, and a
history with open and delete. No new dependency; the API is unchanged.

- Tests: web 1,901 passed in 101 files (the new ones: 249 in 12 files, passed three runs in a row);
  9 browser tests (`e2e/ai-panel.e2e.ts`) on Chromium and on WebKit, with axe (contrast and target
  size on) open, running and with a result. Lint, both typechecks clean. The e2e API now uses the fake
  model, with two test-only routes (`/__e2e/ai/next`, `/__e2e/ai/release`) that exist only there.
- Mutation check, 15 breaks, 14 caught: polling after the end; double start; no "trouble" notice; never
  giving up; a vanished run not noticed; double Cancel; no longer waits after failures; a run going at
  page load not found again; loading before the panel is opened; no privacy notice; Run enabled for a
  text that is too long; every quote shown as found; an unencoded id in a link; an inherited name such
  as `constructor` reaching the wording tables. One survived: removing the "was the project left?"
  comparison in `start`, which the abort signal already covers (a redundant guard, kept as defence).
- Found by the tests: the wording tables answered a server code such as `constructor` with a function
  (fixed with an own-key lookup); my first `useMemo` in the writing page sat after early returns and
  broke the order of hooks (removed); under Vitest's fake timers every `user.click` hung until a small
  `jest` stub was added in the panel's test file.
- One more finding of design: the API allows one pending run per person across all projects, so a 409
  on start can name a run in another project. The panel looks for it in this project and otherwise
  says so in words.
- Open: no live run through the browser against the real model (only the fake); the idea generator (5c).

## Outcome of PR 5c-1 (the idea generator API, `feat/ai-ideas-api`)

Done as planned. Web is untouched (5c-2 follows).

- Built: migration `0004` (`ai_analyses.focus`, at most 500 characters, a check); `ai/prompts/ideas.ts`;
  `kind: "ideas"` in the create body, with an optional `focus` (one plain line, 400 for a plot-hole scan);
  the stored and returned run is a union by `kind`, every run now carries `focus` (`null` when none); the
  service picks the task, the answer shape and the checking by kind (quotes verified, `goesIn` kept only
  when it names an item of the text); the fake model answers an ideas request with a believable idea.
  Standing instructions and manuscript are byte-identical across kinds (a test), so the cache is reused.
- Tests: API unit 1,113 -> 1,173; API integration 921 -> 950; lint, both typechecks and `bun audit`
  clean; the new integration file passed three runs in a row. Mutation check: 12 real breaks, all caught
  (focus not normalised, focus allowed for a plot-hole scan, limit off by one, blank focus kept, `goesIn`
  not checked, quotes always verified, plot-hole task for ideas, focus not stored, ideas read back as plot
  holes, body limit back to 1 KiB, answer shape not checked, fake not kind-aware).
- Found by the tests: the start route's body limit (1 KiB, from 5a) would have refused a 500-character
  focus in a language with 2-byte or longer characters as "too large"; it is now 4 KiB. Three older tests
  changed on purpose: `ideas` used to be the example of a kind that does not exist, and every answer now
  has a `focus` key.
- Not verified: a live ideas run against the real model (one smoke test, a few cents, needs your approval);
  the quality of the ideas is unmeasured. Migration `0004` is NOT applied to the development database yet.

## PR 5c-2 (the idea generator in the web panel, `feat/ai-ideas-web`)

Status: approved (decisions taken as recommended, "a for all"): the mode is a radio group, the focus
text is kept after a run, one PR. No API change, no new dependency.

### Goal

In the writing screen's panel a writer can switch between "Find plot holes" and "Get ideas". For ideas
they can type an optional focus (at most 500 characters), and they get idea cards with quotes and links
into the text. The history says which kind each run was. Done means: unit, page and browser tests green
on both browsers, axe clean in both modes, and the privacy notice tells the truth about the focus.

### What the writer sees

- Heading "AI assistant"; a radio group "What do you want?" ("Find plot holes" / "Get ideas"), locked
  while a run goes; the scope choice, cost hint and Cancel are shared.
- Ideas mode: a labelled multi-line "What should the ideas be about? (optional)" with a hint, a counter
  ("123 of 500", counted like the server: whitespace tidied, a character is a character), an error tied to
  the field over the limit (Run disabled). The text is kept after a run.
- Buttons: plot holes keep "Run the scan" / "Scanning…" / "Cancel the scan"; ideas say "Get ideas" /
  "Thinking of ideas…" / "Cancel".
- Privacy notice: says the text and the focus are sent to Anthropic, and that the results and the focus
  are saved in the history until deleted.
- Results: "Ideas for …", the echoed focus, summary, count, "These are suggestions. Use what helps.",
  idea cards (title, kind in words, description, "Why it fits", quotes found / not found with links,
  "Could go in: <item>" as a link).
- History rows say "Ideas" or "Plot holes"; buttons "Open the ideas for …" / "Open the scan of …".

### Files

`lib/api/analyses-api.ts` (union by kind, `focus`, `kind` for estimate and start); `lib/analyses/`
(`use-analysis-panel.ts`, `analysis-feedback.ts`, `describe-run.ts`, new `focus.ts`); components
(`IdeaCard`, `ModeChoice`, `FocusField`, a shared evidence list; edited `FindingCard`, `AnalysisResult`,
`AiPanel`, `AiPrivacyNotice`); tests, `e2e/ai-panel.e2e.ts`, `test-support/analyses-handlers.ts`; README.

### Tests

API library with MSW (both kinds, mismatched kind and result refused, focus only for ideas, kind in the
estimate); a focus table copied from the API's cases (spaces, line breaks, invisible characters, emoji,
exactly 500 and 501); hook with fake timers (mode and focus reach the start, mode change reloads the
estimate, resume in the right mode, stale answers dropped); components; panel; axe in both modes; browser
tests on Chromium and WebKit; a mutation check; a full browser run.

### Security and accessibility

All AI text and the echoed focus are shown as plain text; links only from known ids; nothing new is kept
in the browser. Radio group with a label, focus field with label, hint and error tied to it, counter not
a live region, kinds and quote checks in words, 24 px targets, contrast as before.

### Alternatives and risks

Rejected: a second panel, tabs, a creativity slider. Risks: the union touches 5b code; the focus count
could differ from the server's (guard: a shared case table); the heading rename touches 4 files.

### Outcome of PR 5c-2 (the idea generator in the web panel, `feat/ai-ideas-web`)

Done as planned; no API change and no new dependency. Decisions taken as recommended: radios for the
mode, the focus text kept after a run, one PR.

- Built: the panel is "AI assistant" with a mode choice; a focus field for ideas (counter in the hint,
  error tied to the field, said once to a screen reader, Run off over 500 characters); idea cards;
  `EvidenceList` shared by findings and ideas; history rows and buttons named per kind; wording by kind
  (`thingFor`); `analyses-api.ts` is a union by `kind`; `focus.ts` copies the API's focus rules with the
  API's own test cases; the privacy notice says the focus is sent and saved.
- Deliberate wording changes to older code (their tests changed on purpose): "Plot-hole finder" is
  "AI assistant"; "Earlier scans" is "Earlier results" (the list holds both kinds); the allowance is
  "AI requests" (it is shared); "too long for one scan" is "too long for the AI to read in one go";
  "not switched on" no longer says "scan"; a 409 elsewhere says "AI request". The Cancel button for
  ideas reads "Cancel the request" (the plan said "Cancel").
- Tests: web 1,913 -> 2,080 in 111 files; 10 new browser tests (Chromium and WebKit) with axe in ideas
  mode (open, too long, running, with a result); lint, both typechecks and `bun audit` clean. Full
  browser run: 422 passed, 2 skipped, 2 failed on WebKit in `sign-out-race.e2e.ts`, which passed 12 of
  12 when run alone (a load flake, like the known WebKit login test; unrelated to this PR).
- Mutation check: 25 real breaks, all caught (invisible characters, UTF-16 count, off-by-one limit, blank
  focus sent, focus sent for a plot-hole scan, estimate kind, wrong result shape accepted, no focus
  check before start, kind missing from the estimate key, uncleaned focus, scan wording for ideas,
  history word, running run's kind ignored, Run not stopped by a long focus, a long focus blocking a
  scan, privacy notice without kind, mode unlocked while running, error one late, link to an item not
  in the outline, unencoded id, every quote "found", focus not shown, result titled as a scan).
- Found by the tests: my own arithmetic and `getByText` (matches the `<strong>`, not its paragraph)
  mistakes, not product bugs. A hook that read a stale `focus` was avoided by putting `kind` and `focus`
  in `start`'s dependencies.
- Not verified: ideas through a real browser against the real model (the live tour); large manuscripts;
  quality of the ideas. The dev servers were stopped by the system for low memory, not restarted.
