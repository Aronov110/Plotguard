# Plotguard

An app that helps writers of scripts and stories find plot holes and get ideas with AI.
Users sign up and sign in, and their work is stored in a database.

> Status: early development. See `.plans/` for the roadmap and per-step plans.

## Prerequisites

- Node.js >= 24 (LTS or newer)
- [bun](https://bun.sh) (package manager; the only lockfile is `bun.lock`)
- Docker (for the local PostgreSQL database)

## Setup

```sh
cp .env.example .env     # then change POSTGRES_PASSWORD (and DATABASE_URL to match)
bun install
bun run db:up            # starts PostgreSQL on 127.0.0.1:5432
```

## Run

```sh
bun run --filter @plotguard/api dev    # API on http://127.0.0.1:3000  (GET /health)
bun run --filter @plotguard/web dev    # Web on http://127.0.0.1:5173
```

## Checks

```sh
bun run lint
bun run typecheck
bun run test
```

## Layout

```
apps/api   Fastify backend (TypeScript, Zod-validated env config)
apps/web   React + Vite frontend (Atomic Design under src/components)
.plans/    Dated plans with a status header (draft / approved / done)
```
