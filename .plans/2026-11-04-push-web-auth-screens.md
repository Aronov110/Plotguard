Status: done (2026-11-04), merged in PR #9. Decision 1: option A (open the PR now, Playwright tests
become their own PR 3). Decision 2: option A (this plan is committed on the branch).

# Push `feat/web-auth-screens` and open the PR

## Goal

Put the 3 local commits on GitHub and open a pull request into `main`, in the style of PRs #4-#8.
Done means: the branch exists on GitHub, `git ls-remote` shows its tip equal to the local tip, the
PR is open against `main`, and the PR text lists honestly what is and is not in it.

## Tech choices

- `git push -u origin feat/web-auth-screens` (first push of the branch, sets the upstream).
- `gh` 2.102.1 for the PR (installed, logged in; all earlier PRs came from the same account).
- Checks are the repo's own scripts: Biome, `tsc`, Vitest, `vite build`, `bun audit`.
- No new dependencies in this task. The branch itself adds `react-router`,
  `@testing-library/user-event` and `axe-core`.
- The repo has no `.github/`, so no CI runs on the PR. The local checks are the only safety net.

## Files to change

- `.plans/2026-11-04-push-web-auth-screens.md` (new): this plan, one small commit on the branch.
- `.plans/2026-11-02-auth-frontend.md` is not touched; its status is updated in a later housekeeping
  change after the merge (as PR #7 did).

## Checks before the push

1. Working tree clean apart from this plan; `git ls-remote origin main` still equals local `main`
   (`ee654ce`). If `main` moved: stop and ask before any rebase.
2. `bun run lint`, `bun run typecheck`, `bun run test` (web; the API is untouched),
   `bun run --filter @plotpal/web build`, `bun audit`.
3. Diff scanned for secrets by pattern and by hand; `.env` stays ignored and untracked.
4. A failing check stops everything. No test is edited to make it pass. No force-push.
5. Before creating the PR: `gh pr list --head feat/web-auth-screens` shows no existing PR.

## Security and accessibility

- The push publishes the 3 commits for good. Hence the secret scan.
- `bun audit` covers the new packages.
- Review finding #2 (a possible logout-versus-login race) is still open and is stated in the PR.
- The PR text carries no hostnames, personal data or exploit steps.
- axe checks and the contrast test exist; the real-browser axe runs belong to the Playwright PR.

## Decisions and open items

- **Playwright:** the approved Step 3 plan put Playwright tests into PR 2, but they are not on this
  branch and `@playwright/test` is not installed. Chosen: open this PR now and say so in it; add the
  browser tests as PR 3 on a new branch. They must cover the `Set-Cookie` round trip through the
  dev proxy (promised in PR #8) and review finding #2.
- **Not taken:** holding the PR back; a draft PR; squashing the 3 commits (their messages carry the
  review reasoning).

## PR text outline (style of #8)

- Title: `Add web auth screens: login, sign-up, routing and guards`
- Sections: What, Found while writing the tests, Checks (numbers from the fresh run), Notes for
  review (Playwright gap, finding #2 open, `vitest-axe` skipped because unmaintained, `react-router`
  pinned to 8.4.0 instead of the six-day-old 8.5.1).
- Last line: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## Commit

Message for the plan file: `Add the plan for pushing the web auth screens`, last line
`Used model: Claude Sonnet 5.5`. No `Co-Authored-By` line (global rule).
