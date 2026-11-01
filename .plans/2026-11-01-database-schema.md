Status: done (2026-11-01), pending review and commit

# Step 1: Database schema and migrations

Outcome notes:
- 5 tables, 2 migrations (`0000_initial_schema` generated, `0001_triggers` hand-written).
- Checks: Biome and `tsc` clean; 48 unit tests and 130 integration tests pass.
- `bun audit`: 1 moderate advisory in esbuild 0.18.20, pulled in by drizzle-kit's legacy loader.
  Only affects esbuild's own dev server, which is not used. Left unfixed pending a decision.
- Documents nest one level deep, enforced by a trigger. Not enforced in SQL: that an analysis's
  `document_id` belongs to the same project as the analysis (validate in the application layer).

## Decisions (approved 2026-11-01)

- Postgres 18 (`postgres:18.6-alpine`) for native `uuidv7()`. PG 18 changes the Docker volume
  layout (mount `/var/lib/postgresql`), so the empty PG 17 volume is recreated.
- Drizzle ORM + drizzle-kit migrations (pre-1.0, exact versions pinned) with the `pg` driver.
- Hard deletes with `ON DELETE CASCADE`. Soft delete / trash is a later feature.
- Documents have one optional `parent_id` level (act -> chapter or scene).
- `documents.content` is plain `text` (Fountain for screenplays, plain text or Markdown for prose).
- `users.display_name` is nullable.
- Text columns with CHECK constraints instead of Postgres enums.
- `updated_at` is maintained by a database trigger.

## Schema

All tables: `uuid` primary key `DEFAULT uuidv7()`, snake_case, `timestamptz` (UTC).

- `users`: email (lowercase CHECK, unique), password_hash, display_name, timestamps.
- `refresh_sessions`: user_id, family_id, token_hash (unique, SHA-256 of the token), expires_at,
  revoked_at, created_at.
- `projects`: user_id, title (1-200), format (screenplay | prose | other), logline, timestamps.
  Index `(user_id, updated_at DESC, id)` for cursor pagination.
- `documents`: project_id, parent_id (composite FK keeps the parent in the same project), title,
  content, position (>= 0), word_count (>= 0), timestamps.
- `ai_analyses`: user_id, project_id, document_id (SET NULL), kind (plot_holes | ideas),
  scope (document | project), status (pending | succeeded | failed), model, input_tokens,
  output_tokens, result (jsonb), error_code, created_at, completed_at.

Deferred: email_verified_at, password reset, ai_findings.

## Files

Changed: `docker-compose.yml`, `.env.example`, `package.json` (root), `apps/api/package.json`,
`README.md`.

New (under `apps/api`):

- `drizzle.config.ts`, `vitest.config.ts`
- `src/db/schema/*.ts` (one file per table, no barrel)
- `src/db/client.ts`, `src/db/migrate.ts`, `src/db/migrate-cli.ts`
- `src/db/test-support/*`
- `drizzle/*.sql` (generated, plus a hand-written trigger migration)
- `src/db/__tests__/*.integration.test.ts`

Added during implementation: an index on `ai_analyses.document_id` (found by the schema-conventions
test), and `DESC NULLS FIRST` on the pagination indexes so `ORDER BY ... DESC` needs no extra Sort
step (found by an EXPLAIN test). Both were fixed in the unreleased initial migration.

## Test plan

Integration tests run against a separate `plotguard_test` database; the helper refuses to run
unless the database name ends in `_test`. Unit tests (no database) stay in `bun run test`;
integration tests run with `bun run test:integration`.

- Migrations: apply to an empty DB, re-run is a no-op, no drift from the schema.
- UUIDv7: version nibble is 7, IDs are time-ordered.
- Every CHECK, UNIQUE and FOREIGN KEY constraint is exercised with a rejected and an accepted value,
  including boundaries (title 1 and 200 vs 0 and 201 characters).
- Cascades: user -> sessions/projects/documents/analyses; project -> documents/analyses;
  parent document -> children; document -> analysis.document_id set to NULL.
- Trigger: updated_at changes on update, created_at does not; timestamps independent of session
  timezone.
- Regression: existing unit tests, Biome and tsc stay green.

## Security notes

- Parameterized queries only (Drizzle). Session tokens stored hashed. No IP or user agent stored.
- User content (`content`, `result`) is removed by cascade deletion.
- Local app role is the container superuser; production needs a least-privilege role (Step 6).
- Ownership checks (`user_id` on every query) arrive with the Step 2 and Step 4 endpoints.

## Risks

- Plain-text `content` may not suit the Step 4 editor; migrating to JSONB is a normal migration.
- Drizzle is pre-1.0; versions are pinned exactly.
- Migrations are immutable once merged; later changes go in new migrations.
