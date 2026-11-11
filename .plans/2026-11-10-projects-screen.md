Status: done (2026-11-10), pending review and merge. Decisions taken as recommended ("A for all"): 1-A split 4c in two
(4c-1 = list, paging and create, this plan; 4c-2 = edit and delete, next PR); 2-A the create form is
on the page; 3-A small hand-written hooks, no data library; 4-A a "Load more" button; 5-A project
titles do not link anywhere yet (the writing screen is 4d).

# Step 4, PR 4c-1: the "Your projects" screen

## Goal

A signed-in person opens `/app` and sees their real projects (title, format, logline, last-changed
date). They can create a project and load more when they have more than 20. Loading, empty, failure
and rate-limited states are all handled. The placeholder text goes away. Done means: tested, lint,
typecheck and `bun audit` clean, browser tests green in Chromium and WebKit (axe in light and dark
mode, keyboard-only journey, 320 px reflow).

## Tech choices

The web app's own stack: React 19, react-router 8, Zod 4, Vitest, Testing Library, MSW, axe,
Playwright. No new dependency. Atomic Design folders, a CSS file beside each component, tests in
`__tests__/`, no barrel files. The access token stays in memory; calls go through `withAuth`. The dev
proxy already forwards `/projects`.

## Files (under `apps/web/` unless noted)

New, data layer (`src/lib/`): `api/projects-api.ts` (the web's copy of the projects API, answers
checked with Zod), `projects/use-projects.ts` (first page, load more, add without duplicating,
cancel on leaving), `projects/use-create-project-form.ts` (the form behaviour),
`projects/project-form-feedback.ts` (API errors in plain sentences), `projects/format-changed-date.ts`
(one place for the date text), `test-support/projects-handlers.ts` (fake API answers and factories).

New, components: `atoms/TextArea`, `molecules/TextAreaField`, `molecules/RadioGroupField`,
`molecules/ProjectListItem`, `organisms/CreateProjectForm`, `organisms/ProjectList`.

Changed: `pages/AppHomePage` (the real screen; the heading stays "Your projects"),
`e2e/journeys.e2e.ts`, `e2e/accessibility.e2e.ts`, `e2e/keyboard-and-focus.e2e.ts`,
`e2e/support/api-control.ts` (creates projects through the API), `README.md`, this plan.
`http.ts` and `routes.tsx` stay unchanged (GET and POST are enough; PATCH and DELETE come in 4c-2).

## Defaults taken

Format is a radio group with Screenplay preselected. A blank logline is not sent. The page checks only
that required fields are not empty; every other rule is the API's (single rulebook). No `maxLength`
on the inputs (the API counts characters, the browser counts UTF-16 units). Dates show as
"Changed 7 Nov 2026" in a `<time>` element. No Storybook stories (the repo has none; that PR is the
postponed one).

## Test plan and edge cases

API client (valid page, wrong shape, Bearer header, encoded cursor, exact create body, blank
logline); `use-projects` (first load, empty, failure and retry, load more with dedupe, end of list,
double click, failure keeps shown items, expired token renewed once, cancel on leaving, create racing
the first load); form feedback (400 pointers including `/__proto__`, 429 with and without
Retry-After, 503, no connection, unknown error); components (labels, `aria-describedby`,
`aria-invalid`, busy, arrow keys in the radio group, markup and RTL text shown as text, axe); page
(loading, empty, 1, 20, 21 items, create success and failure, double submit, signed-out redirect);
browser (empty state, keyboard-only create, reload keeps it, 21 projects and "Load more", axe light
and dark, 320 px, target size, focus order).

## Security and accessibility notes

OWASP A03 (all text rendered as text, no `dangerouslySetInnerHTML`), A01 (only what the API returns
for the signed-in person), CSRF (`POST /projects` uses the Bearer header, not a cookie), A04 (429
message and busy button), A05 and A09 (token in memory only, titles never logged). WCAG 2.2 AA:
headings and landmarks, labels and instructions, error summary and inline errors, no retyping after
a failure (3.3.7), status messages (4.1.3), focus visible, 44 px targets, 320 px reflow. Focus: a
failed create goes to the error summary, a successful one to the title field, "Load more" to the
first new item.

## Alternatives and risks

Rejected: TanStack Query (new dependency, little help for 4d conflicts), endless scrolling
(inaccessible), a create dialog (heavy focus code), optimistic UI (the server makes the id and date).
Risks: many browser tests look for the heading "Your projects" on `/app`; the two known WebKit flakes
are still open and `retries` is 0; `Intl` output differs by language (tests pass a locale and time
zone); a 1,000-character logline must wrap at 320 px.

## Outcome

Done as planned, with the deviations below. API untouched.

- Tests: web unit 761 -> 962 (201 new; the 7 tests of the old placeholder page became 22 for the real
  screen). Browser: 21 new tests, each run in Chromium and WebKit (42 runs); the whole suite passed
  213 with 1 skipped (the skip was there before). Lint, typecheck and `bun audit` clean; API suites
  unchanged (930 unit).
- Mutation check (code broken on purpose, then restored byte for byte): no dedupe of projects fails
  2 tests, rendering the logline as HTML fails 1, not cancelling requests on leaving fails 1, not
  moving the focus after "Load more" fails 4. Removing the guard against a double submit failed
  nothing at first (the button's own busy check hides it), so a test that submits the form itself
  twice was added; with the guard removed it now fails.
- Found by the tests: `user-event` does not see a programmatic `form.reset()` and would type
  "Two" after "One"; a real browser does not, which the browser test "A real browser empties the
  field" proves. The unit test clears the library's memory first and says why.

Deviations from the plan:

- **Browser tests are in a new file**, `e2e/projects.e2e.ts`, instead of three edits in existing files
  (the existing accessibility, reflow and target-size tests of the signed-in home already run against
  the new screen). Only `e2e/support/api-control.ts` changed (`createProjects`, through the API).
- **No separate test file for `use-create-project-form.ts`**: the hook is tested through
  `CreateProjectForm`, where its refs and handlers are used.
- `test-support/projects-handlers.ts` (planned) also holds `answerCreateProject` and `created`.
- `use-projects.ts` carries one `biome-ignore` (the retry counter is a dependency that the effect does
  not read, on purpose).
- A load that fails after a project was created hides that project until "Try again" works (it is
  kept, not lost). Rare, and accepted.

Known and open, not part of this change: two intermittent browser failures seen in the first full
run. (1) `cookies-and-storage.e2e.ts` "both cookies are gone after signing out" reads the cookies
before the sign-out answer arrives (already noted in `2026-11-05-sign-out-login-race.md`); it failed
1 time in 20 on the old placeholder page and 3 in 20 with the new screen (same test, small sample),
so it is a timing mistake in that test. (2) One WebKit failure of `sign-out-race.e2e.ts` that did
not come back in 12 runs on either version. The second full run was clean.
