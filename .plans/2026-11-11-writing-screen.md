Status: done (2026-11-11), pending review and merge. Decisions taken as recommended ("A for all"): 1-A the editor is a plain
multi-line text box (CodeMirror for Fountain colouring can come later; a rich-text editor would fight
the API's plain-text contract); 2-A two PRs (4d-1 is this plan: the screen, the outline, adding items,
editing text with autosave and conflict handling; 4d-2 is rename, move and delete of outline items);
3-A the text is saved 2 seconds after the last keystroke, when the box or the document is left, with
Ctrl/Cmd+S for "now", and the browser warns before closing the tab with unsaved text; 4-A on a 412 the
writer's text stays on screen with two buttons ("Save my text over theirs", "Load the newer text");
5-A a document's address is `/app/projects/:projectId?document=<id>` (a query string, so `RouteFocus`
does not pull the focus away from the editor, Back works and the link can be shared). A document's
`DELETE` stays without `If-Match` (decided on 2026-11-11).

# Step 4, PR 4d-1: the writing screen

## Goal

A signed-in writer opens a project and gets a writing screen: the outline (acts, chapters, scenes) beside
the text. Selecting an item opens its text in an editor; typing is saved automatically and the screen
always says whether the text is saved; if another tab saved a newer version first, nothing is silently
overwritten. Done means: tested, lint, typecheck and `bun audit` clean, browser tests green in Chromium and
WebKit (axe in light and dark mode, keyboard only, 320 px, target size). The API is untouched.

## Tech choices

Same stack, no new dependency: hand-written hooks, Zod-checked API calls through `withAuth`, atomic design
with a CSS file beside each component. The HTTP client gets an `ifMatch` option (`If-Match: "N"`). The
autosave logic is a framework-free controller (`document-saver.ts`, like the session manager) with a thin
React hook, so its timing rules can be tested with fake timers.

## Files (under `apps/web/`, unless noted)

New: `lib/api/documents-api.ts`, `lib/projects/use-project.ts`, `lib/documents/{count-text,
document-feedback,document-saver,use-document-editor,use-outline,use-add-item}.ts`,
`test-support/documents-handlers.ts`, `components/pages/WritingPage`,
`components/organisms/{OutlineNav,DocumentEditor,AddItemForm}`, `components/molecules/{SaveStatus,
ConflictNotice}`, `e2e/writing.e2e.ts`.

Changed: `lib/api/http.ts` (`ifMatch`), `lib/api/projects-api.ts` (`get`), `routes.tsx`, `AppLayout`
(a `wide` option), `ProjectSummary` and `ProjectEntry` (the title links to the writing screen),
`README.md`, this plan.

## Defaults taken

The project cards' titles link to the screen. The editor box is uncontrolled (the text lives in the box,
not in React state). Characters are counted as the API does (an emoji is one) and shown only from 190,000
of 200,000. The word count shown is the server's, after each save. No draft backup in browser storage.
"Saved" is shown but not announced every few seconds; errors and conflicts are announced; Ctrl/Cmd+S
announces "Saved.". A text typed through an input method (IME) is saved after the composition ends.

## Test plan and edge cases

Autosave with fake timers (2 s wait and its restart, one save at a time, text typed during a save, version
+1, typed back to the saved text, leaving and Ctrl/Cmd+S saving at once); failures (offline with backoff
and recovery, 429 with Retry-After, 401, 400 invalid text, 404, 412 conflict with both buttons); editor
(load, label, limit warning, exact text with emoji, right-to-left and line breaks, hostile markup as text,
large paste); outline (order, one level, current item, adding an act and a scene, the 1,000 cap, empty
project, unknown project); focus (selecting goes to the editor, adding opens the new item); browser (write
and reload, keyboard only, two tabs and the conflict, offline and recovery, close with unsaved text, axe
light and dark, 320 px, targets).

## Security and accessibility notes

OWASP A01 (the server filters by owner; ids come from the API and are encoded), A03 (all text as text, the
editor is a plain `textarea`), A04 (debounce and backoff keep far below the write limit), A09 (text is
never logged), nothing private in browser storage. WCAG 2.2 AA: landmarks and skip link (1.3.1, 2.4.1),
focus (2.4.3, 2.4.7), errors in words with a way out (3.3.1, 3.3.3), status messages (4.1.3), reflow
(1.4.10), target size (2.5.8), no timeouts that discard typing (2.2.2, 2.2.6).

## Alternatives and risks

Rejected: a rich-text editor, a draft backup in browser storage, a `keepalive` save on closing (about a 64
KB limit, a text can be 2.4 MB), a side-by-side merge. Risks: autosave races (hence the test set); a tab
closed in the last two seconds can lose them (warning, save on leaving and on blur reduce it); native
undo must not be wiped by rewriting the box after a save; two known browser flakes with `retries` at 0;
the outline on a phone stacks above the text.

## Outcome

Done as planned, with the deviations below. API untouched.

- Tests: web unit 1134 -> 1440 (306 new). Browser: 31 new tests, each in Chromium and WebKit (62
  runs; one is skipped in WebKit on purpose); the whole suite passed 328 with 2 skipped (one was
  there before) and none failed. Lint, typecheck and `bun audit` clean; API suites unchanged.
- Mutation check (code broken on purpose, then restored byte for byte), all caught: a keystroke not
  restarting the wait (3 tests), the next save forgetting the new version (6), `flush` saving during a
  conflict (3), text typed during a save waiting for the next pause (2), a 412 treated as a passing
  failure (9), leaving the box not saving (16), no warning before closing the tab (2), half an
  input-method character being saved (1), "load the newer text" not resetting the autosave (1),
  reopening a document not waiting for its own pending save (1), unencoded ids in addresses (2),
  no `If-Match` header (5).
- Found by the browser tests: with a 200-character title, the "Inside “…”" choice of the add form had no
  wrapping rule and pushed the page 1,483 px wider than a 320 px screen (unit tests cannot see layout).
  Fixed in `RadioGroupField.css` (a merged component from 4c-1). Two of the first browser runs also
  failed because of mistakes in the new tests themselves (two logins in one test; the close-tab prompt
  was not awaited); both were corrected in the tests.

Deviations from the plan:

- **`deleteDocument`** was added to the browser-test helpers (`e2e/support/api-control.ts`) so that
  "deleted elsewhere" is a real deletion, not a faked answer.
- The tests of `ProjectEntry` and `ProjectList` now render inside a router, because a project's title is
  a link; `AppLayout` and `ProjectSummary` got new test files for their new options instead of edits to
  the existing ones.
- The outline shows the server's word count after each save; there is no live local word count.
- Opening a document again waits for that document's own pending save (`leaving` in
  `use-document-editor.ts`); the plan did not mention it, the tests showed the need.

Known and open, not part of this change: renaming, moving and deleting outline items (4d-2); a tab closed
within two seconds of the last keystroke without answering the prompt can lose those words; the close-tab
prompt is tested only in Chromium; "Load the newer text" replaces the writer's text and resets the box's
undo history on purpose; there is no draft backup in browser storage; a document's `DELETE` still needs
no `If-Match` (decided on 2026-11-11).
