Status: done (2026-11-12), pending review and merge. Approved the same day. Decisions taken as recommended ("a for all"): 1-A the controls act on the open
item only (one group above its text); 2-A moving is done with buttons only (Move up, Move down, Move
to…), drag-and-drop can come later with a library; 3-A after a rename or move the outline is read again
from the server; 4-A the existing `DeleteConfirmation` is generalised (no second near-identical
component); 5-A one PR on `feat/outline-editing`. A document's `DELETE` stays without `If-Match`
(decided on 2026-11-11).

# Step 4, PR 4d-2: rename, move and delete outline items

## Goal

On the writing screen the writer can rename, move and delete the open outline item. Moving is up, down,
into an act or chapter, or back to the top level, always with plain buttons (WCAG 2.5.7). Done means:
tested, lint, typecheck and `bun audit` clean, browser tests green in Chromium and WebKit (axe in light
and dark mode, keyboard only, 320 px, target size). The API is untouched. Nothing the writer typed is
lost, and a rename never puts the writer's own text in conflict with itself.

## What the code showed

1. The outline list has no `version`, but `PATCH` needs `If-Match`. Only the open item has a version
   (held by its autosave). So the controls act on the open item.
2. Renaming or moving the open item with its own request would make the next text save use an old
   version and get a 412 against itself. The autosave therefore runs structural changes itself, in its
   own single-flight (`exclusive`).
3. The API already does everything: `PATCH` takes `title`, `parentId`, `position`; `DELETE` removes an
   item with its children and renumbers the siblings.

## Tech choices

Same stack, no new dependency: hand-written hooks, Zod-checked calls through `withAuth`, atomic design
with a CSS file beside each component, `<fieldset>`, `role="status"` messages and the focus rules of 4c-2
and 4d-1.

## Design

- Group "Actions for “<title>”" above the text: Rename, Move up, Move down, Move to…, Delete.
- `document-saver.ts` gets `exclusive(call)` (waits for a running save, saves pending text first, runs
  the call on the current version, keeps the new version; 412 gives conflict, 404 gives gone, any other
  failure goes back to the caller and leaves the text status alone) and `abandon()` (stops without
  saving, for a deleted item).
- After a rename or move the outline is read again (`useOutline.refresh`), keeping the old list on
  screen until the new one arrives.
- Up and Down change `position` by 1 among the siblings; "Move to…" is a native select (top level, or
  inside an act or chapter; items with children get no "inside" choices). The pressed button keeps the
  focus; at the edge of the list, where it becomes disabled, the focus goes to the other arrow. The
  result is announced.
- Delete reuses the question ("Keep" has the focus, Escape keeps), says how many scenes go too; after a
  delete the address loses `?document=`, the focus goes to the outline heading, and it is announced. A
  404 on delete counts as done.

## Files (under `apps/web/`, unless noted)

New: `.plans/2026-11-12-outline-editing.md`, `lib/documents/{item-moves,use-item-actions}.ts` (+ tests),
`components/organisms/ItemToolbar`, `components/molecules/{RenameItemForm,MoveItemForm}`,
`e2e/outline-editing.e2e.ts`.

Changed: `lib/documents/{document-saver,use-outline,document-feedback,use-document-editor}.ts` (+ tests),
`lib/api/documents-api.ts` (`remove`), `DocumentEditor`, `WritingPage`, `DeleteConfirmation` and
`ProjectEntry` (+ tests), `e2e/support/api-control.ts`, `README.md`.

## Test plan and edge cases

Autosave (`exclusive`, `abandon`) with fake timers; `item-moves` (first, last, only child, act with
children, act without, scene to top level, current parent not offered, stale position); rename (empty,
spaces, 200/201 characters, emoji, right-to-left, markup as text, same title, Escape, focus, errors,
heading and labels update); delete (scene, act with children, unsaved text dropped, Keep, Escape, failed
request, already deleted, address and focus); browser tests (rename and reload, keyboard only, move up
and down with the focus, into an act and back, delete an act, two tabs, offline, axe light and dark,
320 px, targets); mutation checks of the lock, the kept version, the flush before the call, a 400 marking
the text invalid, the focus after a move, the default focus of the question, 404 as done.

## Security and accessibility notes

OWASP A01 (server filters by owner; ids encoded), A03 (titles as text), A04 (one request at a time per
action, far below 120 per minute), A08 (`If-Match`), A09 (nothing logged). WCAG 2.2 AA: 2.5.7 (no drag
needed), 2.5.8 (24 px), 2.4.3 and 2.4.7 (focus after each action), 3.3.1 and 3.3.3 (errors in words),
4.1.3 (status messages), 2.5.3 (visible "Move up" is in the name; the group names the item), 1.4.10.

## Alternatives and risks

Rejected: buttons on every row, `version` in the API's outline (a follow-up), drag-and-drop now, local
computing of the moved list. Risks: changing the autosave (its 58 tests, the mutation checks and the
browser tests are re-run); another tab with the same item open gets a conflict notice on its next save
after a rename (the API raises `version` on every accepted change; the text is safe and "Save my text
over theirs" keeps the new title); an item must be opened before it can be changed; moving into an act
puts the item last.

## Outcome

Done as planned, with the deviations below. API untouched.

- Tests: web unit 1440 -> 1652 (212 new), API unchanged at 930. Browser: 28 new tests, each in Chromium and
  WebKit (56 runs), all passed when run on their own. Lint, typecheck and `bun audit` clean.
  The last full browser run of the whole suite did not report (its output was empty), so the whole
  suite was not re-run after the last two small edits (an element id in the toolbar, and a ref written
  in an effect instead of during render in `useOutline`); those files' own tests passed.
- Mutation check (code broken on purpose, then restored byte for byte), 15 of 15 caught: the lock not
  waiting for a running save, the version not kept, pending text not saved first, a refused title treated
  as a conflict, text typed during a change not saved afterwards, a delete not stopping the autosave, a
  404 on delete as a failure, no outline refresh after a rename, a step up of two places, an act with
  scenes offered places inside others, the delete question not opening on Keep, a really disabled
  (not aria-disabled) Move up, the focus not returning after a form closes, the focus not going to the
  outline after a delete, ids not encoded in the delete address. Three survived the first time: one
  was a gap in the tests (two changes started in the same moment), one was an equivalent mutant
  (replaced by a better one), and one exposed a real weakness: after `abandon()` a later `flush()`
  (a blur while the editor goes away) would still have sent a save to a deleted item. `flush` now
  does nothing after `abandon`.
- Found by the tests: a named `<form>` is a landmark, so the rename form has no name of its own; the
  error text of a field carries an "Error:" prefix; WebKit does not focus a button that is clicked, so
  the focus tests in the browser use the keyboard; pressing Enter on a drop-down list does not submit
  a form in real browsers (the move form is used with Tab to the Move button).
- Found by the writer: the development database had not had migration `0002` (the `version`
  column) applied, so adding an item gave a 500. Not a code bug; applied with `bun run db:migrate`.

Deviations from the plan:

- **Unavailable buttons are `aria-disabled`, not disabled**, and keep the focus, instead of moving the
  focus to the other arrow when an item reaches the end of its list: simpler, and the focus never jumps.
- **A `Select` atom** was added (`components/atoms/Select`): the move form needs a drop-down list and
  there was none.
- The announcements are kept in `WritingPage` (a deleted item takes its toolbar with it).
- `flush()` ignores calls after `abandon()` (see the mutation check).

Known and open, not part of this change: an item whose text cannot be loaded (the editor shows its
error) has no toolbar, so it cannot be renamed, moved or deleted from the screen; only the open item
can be changed (an item must be opened first); a deleted item stays in the outline until it is read
again (a moment); drag-and-drop (needs a library; the buttons already satisfy WCAG 2.5.7); `version`
in the API's outline would allow acting on unopened items; unit tests that check the focus or a
real-timer status straight after rendering (`DocumentEditor`, `WritingPage`) fail now and then
when the machine is busy (a different one each time; they pass alone and on a clean run).
