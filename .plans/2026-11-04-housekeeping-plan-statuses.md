Status: done (2026-11-04), status part in the PR; branch cleanup follows after the merge.
Decisions 1, 2 and 3: option A for all.

# Housekeeping: plan statuses, then branch cleanup

## Goal

Make `.plans/` match reality and tidy the merged branches. Done means: no plan says `approved` or
`draft` for work that is merged, the `done` edit of the push plan is on GitHub, and the 6 merged
branches are deleted (separate step, separate approval).

## Tech choices

- A `chore/mark-plans-done` branch with `git` and `gh`, as in PR #7. Never a commit on `main`.
- Plain imperative commit messages, last line `Used model: Claude Sonnet 5.5`, no `Co-Authored-By`.
- Checks: `bun run lint` (Biome also formats the markdown tables), `typecheck`, web tests.
- Merge commit, with `gh pr merge --merge --delete-branch` (decision 2: a flag, no change to the
  GitHub repository setting).
- No new dependencies, no young tools.

## Files to change

1. `.plans/2026-11-02-auth-frontend.md`: status `approved` becomes `done`, naming PRs #8 and #9.
   Add an outcome note: Playwright tests moved to a future PR 3; Storybook is still its own PR
   before Step 4.
2. `.plans/2026-11-04-push-web-auth-screens.md`: status `done (2026-11-04), merged in PR #9`.
3. `.plans/2026-11-04-housekeeping-plan-statuses.md` (new): this plan; flipped to `done` in the
   last commit before the push, as the old housekeeping plan was.

## Checks and edge cases

- `bun run lint`, `bun run typecheck`, `bun run --filter @plotpal/web test` (714 expected).
- `grep` for `Status: approved|draft` in `.plans/`; `git diff --stat` shows only `.plans/*.md`.
- The dev servers are running from these files; docs-only changes do not affect them.
- If lint fails: stop and fix. If `main` moved on GitHub: stop and ask before any rebase.
  No force-push.

## Security and accessibility

- Docs only. The risk class is leaking details into git history: no secrets, hostnames or personal
  data; the diff is read by hand before the push.
- Deleting a merged branch loses no history; the commits stay in `main`.
- No UI change, so nothing for WCAG 2.2 AA.

## Branch cleanup (decision 1: A, after the PR is merged)

- Local: `git branch -d` (refuses unmerged work) for `chore/housekeeping`, `chore/rename-to-plotpal`,
  `feat/api-foundation`, `feat/auth-routes`, `feat/web-auth-foundation`, `fix/api-hardening`.
- GitHub: `git push origin --delete` for the same six. The exact list is shown first and the remote
  deletes get their own approval.

## Not taken

Folding the status edits into the Playwright PR (leaves the record stale); committing to `main`
(not allowed); changing the GitHub "delete head branches" setting (decision 2: A, flag only);
a status-only change to the auth-frontend plan (decision 3: A, outcome note added).
