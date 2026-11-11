Status: done (2026-11-11), pending review and merge. Decisions taken as recommended ("A for all"): 1-A editing happens in
place (the project's card turns into the form); 2-A delete is confirmed in place, with the focus on
"Keep project"; 3-A a saved project moves to the top of the list; 4-A the create form's fields and
form logic are extracted once and shared with the edit form.

# Step 4, PR 4c-2: edit and delete a project

## Goal

On "Your projects" each project gets an Edit and a Delete button. Edit opens title, format and
logline with the current values; Save updates the project, Cancel changes nothing. Delete shows a
clear confirmation (it is permanent and also removes the project's documents and analyses). Done
means: tested, lint, typecheck and `bun audit` clean, browser tests green in Chromium and WebKit
(axe in light and dark mode, keyboard only, 320 px, target size). The API is untouched.

## Tech choices

Same stack as 4c-1, no new dependency: small hand-written hooks, Zod-checked API calls through
`withAuth`, atomic design with a CSS file beside each component. The web HTTP client gets `PATCH` and
`DELETE` (it had GET and POST). A path id goes through `encodeURIComponent`.

## Files (under `apps/web/`, unless noted)

New: `lib/projects/use-project-form.ts` (shared form behaviour), `lib/projects/project-changes.ts`
(what changed, `null` for a cleared logline), `lib/projects/use-delete-project.ts` (the delete call
with its busy guard and error), `molecules/ProjectFields`, `molecules/ProjectSummary`,
`molecules/DeleteConfirmation`, `organisms/EditProjectForm`, `organisms/ProjectEntry`.

Changed: `lib/api/http.ts` and `projects-api.ts` (+ `update`, `remove`), `project-form-feedback.ts`,
`use-projects.ts` (replace, remove, notice), `use-create-project-form.ts` and `CreateProjectForm`
(thin users of the shared pieces), `ProjectListItem` (the card frame), `ProjectList`, `AppHomePage`,
`Button` (a `danger` variant, and it now passes a `ref`), `ions/tokens.css` and its test
(`--color-on-danger`), `test-support/projects-handlers.ts`, `e2e/projects.e2e.ts`, `README.md`, this
plan.

## Defaults taken

Save sends only the fields that changed; a cleared logline is sent as `null`; nothing changed means no
request ("No changes to save."). Several cards can be in edit mode at once. Accessible button names
are "Edit project “Title”" and "Delete project “Title”" (visible text Edit and Delete). A 404 on save
says the project no longer exists; on delete it removes the card. The projects API has no version
check, so the last save wins.

## Test plan and edge cases

API client (methods, token, body, encoded id, 204, errors); `project-changes` (nothing, one, all
changed, logline cleared or only spaces, title differing by spaces); `useProjects` (replace moves to
the top, remove, notice serial); edit form (pre-filled, only changes sent, errors keep typing, double
submit, Cancel); delete (names the project and the consequences, focus starts on Keep, Escape cancels,
double press sends once, 404 removes the card, failure keeps it); focus everywhere (open edit goes to
the title, Save or Cancel back to that card's Edit button, after a delete to the next card, else the
previous, else the section heading); page and browser journeys (edit and reload, no-change save, delete
one then the last, keyboard only, hostile text, deleted in another tab, axe light and dark, 320 px,
target size).

## Security and accessibility notes

OWASP A01 (the server checks ownership; ids come from the API's own list and are encoded), A03 (all
text as text), A04 (the shared write limit is handled with a calm message; busy buttons), no CSRF
(Bearer header). Delete is a destructive action: the confirmation, the safe default and the explicit
wording are the control. WCAG 2.2 AA: 3.3.4 error prevention, 3.3.1/3.3.2/3.3.7, 4.1.3 status
messages, 2.4.3/2.4.7 focus, 2.5.3 label in name, 2.5.8 target size, 1.4.1/1.4.3 (the danger button has
words, and its contrast is tested in both themes).

## Alternatives and risks

Rejected: a pop-up dialog (focus-trap code), undo with soft delete (no API support), optimistic updates.
Risks: focus after a delete is the trickiest part (most tests); two known browser flakes with `retries`
at 0; a saved card moving to the top must not lose another card's typed text (cards are keyed by id);
two tabs can overwrite each other's edits (no version for projects).

## Outcome

Done as planned, with the deviations below. API untouched.

- Tests: web unit 962 -> 1134 (172 new). Browser: 27 new tests, each in Chromium and WebKit (54 runs);
  the whole suite passed 267 with 1 skipped (the skip was there before) and none failed. Lint,
  typecheck and `bun audit` clean; API suites unchanged.
- Mutation check (code broken on purpose, then restored byte for byte): no focus move after a delete
  fails 3 tests, the question not opening on "Keep project" fails 3, always sending the title fails 5+,
  an unencoded id in the address fails 2, Escape not keeping the project fails 1, no guard against a
  double delete fails 1, a 404 counted as an error fails 2. One break (not removing a changed
  project's old copy from the fetched list) failed nothing, because it is not observable: the list
  already shows each id once, created or changed first. That line was redundant and was removed.
- Found by the tests: the accessible name of the Edit and Delete buttons came out as
  "Editproject “X”" because a space at the start of the hidden span is dropped (the repo's `Label`
  already warns about this); the space now sits outside the span. Also, with an edit form open the
  page has two "Title" fields (the new-project form's and the edit form's); each is told apart by its
  form's name, and the tests look fields up inside the form.

Deviations from the plan:

- **`lib/projects/use-delete-project.ts` is a new file** (the delete call with its busy guard, error
  and the "404 counts as gone" rule). It keeps `ProjectEntry` readable and is tested on its own.
- **The delete question is a `<fieldset>`**, not a `div` with `role="group"`: Biome asked for the
  native element, which also gives the group name.
- **Browser tests are in a new file**, `e2e/projects-change.e2e.ts`, like 4c-1's. A test of deleting
  someone else's project through hand-made calls was dropped: the API's own access tests prove it.
- `ProjectListItem` became the card frame only (its details moved to the new `ProjectSummary`), so its
  tests were split: the detail tests moved with the code, unchanged.
- One existing test changed on purpose: "a 404 gets the generic sentence" in
  `project-form-feedback.test.ts`; a 404 now says "This project no longer exists.".

Known and open, not part of this change: two tabs can overwrite each other's edits to a project (the
projects API has no version check); deleting a project is permanent (no trash, as in the 4a plan);
the first-load failure after a create still hides that project until "Try again" works (from 4c-1).
