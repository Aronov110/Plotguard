Status: approved

# Rename the project from Plotguard to Plotpal

## Decisions (approved 2026-11-01)

- Display name `Plotpal`; identifiers `plotpal` (package scope `@plotpal`, database, test database,
  database user, Docker volume).
- The GitHub repository was renamed by the owner (old URLs redirect). `origin` was updated.
- The Docker objects named after the old project were removed (container, network, the dev volume,
  which held only throwaway development and test data).
- Historical `.plans/` files get the new name too; only the name changes.
- The local folder is renamed by the owner later. `docker-compose.yml` sets `name: plotpal`, so
  Docker object names no longer depend on the folder name.
- No trademark, domain or package-name search was done for the new name (owner's decision).

## Scope

Tracked files with the old name: both `package.json` files for the workspaces and the root,
`bun.lock` (regenerated, not hand-edited), `README.md`, `.env.example`, `docker-compose.yml`,
`apps/web/index.html`, the home page and its test, two test files that use the old name as fixture
text, and two plan files. The git history contains no mention of the old name.

Local only (not committed): `.env`, where the database user and name change but the password does not.

## Verification

- A case-insensitive search for the old name finds nothing in tracked files or in `.env`.
- The fixture strings in the two test files change, but no assertion changes: every name that was
  accepted before is still accepted, and every name that was rejected is still rejected.
- Biome, `tsc`, unit tests and integration tests pass; migrations apply to the fresh database.
- The web build shows the new name in the page title and heading; the API answers `/health`.

## Risks

- A missed occurrence: covered by the search above.
- Existing clones keep working through GitHub's redirect, but should run `git remote set-url`.
- Claude project memory is keyed to the folder path, so it does not follow a folder rename.
