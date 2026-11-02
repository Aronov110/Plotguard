# Plotpal

An app that helps writers of scripts and stories find plot holes and get ideas with AI.
Users sign up and sign in, and their work is stored in a database.

> Status: early development. See `.plans/` for the roadmap and per-step plans.

## Prerequisites

- Node.js >= 24 (LTS or newer)
- [bun](https://bun.sh) (package manager; the only lockfile is `bun.lock`)
- Docker (for the local PostgreSQL database)

## Setup

```sh
cp .env.example .env     # then change POSTGRES_PASSWORD (and both database URLs to match)
bun install
bun run db:up            # starts PostgreSQL 18 on 127.0.0.1:5432 and waits until it is healthy
bun run db:migrate       # creates the tables
```

If port 5432 is already taken on your machine, set `POSTGRES_PORT` and the port in both database
URLs in `.env`.

## Database

The schema lives in `apps/api/src/db/schema/` (one file per table) and the generated SQL migrations
in `apps/api/drizzle/`. After changing the schema, generate a migration and review the SQL:

```sh
bun run db:generate -- --name=describe_the_change
bun run db:migrate
```

Never edit a migration that has been merged; add a new one. Integration tests use the separate
`*_test` database from `TEST_DATABASE_URL` and refuse to run against any other name.

## Run

```sh
bun run --filter @plotpal/api dev    # API on http://127.0.0.1:3000  (GET /health)
bun run --filter @plotpal/web dev    # Web on http://127.0.0.1:5173
```

API reference (generated from the route schemas): http://127.0.0.1:3000/docs/. Every API error is
an RFC 9457 `application/problem+json` response.

## Checks

```sh
bun run lint
bun run typecheck
bun run test               # unit tests, no database needed
bun run test:integration   # needs the database from `bun run db:up`
```

## Layout

```
apps/api   Fastify backend (TypeScript, Zod-validated env config, Drizzle + PostgreSQL)
apps/web   React + Vite frontend (Atomic Design under src/components)
.plans/    Dated plans with a status header (draft / approved / done)
```
