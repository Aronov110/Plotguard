Status: done (2026-11-02)

# Housekeeping before Step 3

## What and why

- **Plan statuses.** Five plans still said "approved" or "pending review and commit" although their
  work was merged (PRs #2 to #6). The status lines now say "done" and name the PR.
- **esbuild advisory (GHSA-67mh-4wv8-2f99, moderate).** `bun audit` flagged esbuild 0.18.20, which
  came in through `drizzle-kit` > `@esbuild-kit/esm-loader` > `@esbuild-kit/core-utils`. The newest
  stable `drizzle-kit` (0.31.x) still depends on that helper, so upgrading does not help.

## The esbuild override

The root `package.json` has an `overrides` entry that makes only `@esbuild-kit/core-utils` use
esbuild 0.25.12. That is the version `drizzle-kit` itself already uses, so the lockfile now holds one
copy fewer. The advisory is about esbuild's built-in development server, which `drizzle-kit` never
starts, so the real risk was low; the override makes the audit clean without waiting for upstream.

Checks after the change: `bun audit` clean (was 1 moderate); `db:generate` reports "No schema
changes"; `db:migrate` applies; Biome and `tsc` clean; 648 unit, 446 integration and 3 web tests pass.

Side effect: bun 1.4.3 rewrote `bun.lock` from `lockfileVersion` 2 to 3 while saving the override.

## Remove the override when

`drizzle-kit` stops depending on `@esbuild-kit/*`, or `bun audit` no longer lists the old esbuild
without it. To test: delete the `overrides` block, run `bun install` and `bun audit`.
