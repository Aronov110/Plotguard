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
                         # and set JWT_ACCESS_SECRET (the command is in .env.example)
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

## Auth

All under `/auth`; the full reference is at `/docs/`.

| Route                 | Needs                                                   | Gives                              |
| --------------------- | ------------------------------------------------------- | ---------------------------------- |
| `POST /auth/register` | `Origin`                                                | access token + cookies             |
| `POST /auth/login`    | `Origin`                                                | access token + cookies             |
| `POST /auth/refresh`  | `Origin`, `refresh_token` cookie, `X-CSRF-Token` header | new access token + rotated cookies |
| `POST /auth/logout`   | `Origin`, `refresh_token` cookie, `X-CSRF-Token` header | 204, cookies cleared               |
| `GET /auth/me`        | `Authorization: Bearer <access token>`                  | the signed-in user                 |

The access token lives in memory only. The refresh token is an `httpOnly`, `SameSite=Strict` cookie.
The web app copies the CSRF cookie into the `X-CSRF-Token` header.

| Cookie  | Development     | Production (`NODE_ENV=production`) |
| ------- | --------------- | ---------------------------------- |
| refresh | `refresh_token` | `__Host-refresh_token`             |
| CSRF    | `csrf_token`    | `__Host-csrf_token`                |

In production both names start with `__Host-`: browsers then accept the cookie only if it is
`Secure`, has `Path=/` and no `Domain`, and refuse one set by another host, so a sibling subdomain
cannot plant its own login cookies in a visitor's browser. Development uses the plain names (and
`Path=/auth` for the refresh cookie) because browsers refuse `Secure` cookies over plain http.

### Web app

Rules for the web app, and how it follows them:

- **One origin.** The API must be reached from the same host as the page, behind a reverse proxy.
  The page can only read the CSRF cookie of its own host, and a `SameSite=Strict` cookie is not
  sent between `localhost` and `127.0.0.1`. Never loosen the cookie to `SameSite=None` or add a
  `Domain` to work around this. In development the Vite server is that proxy: it forwards `/auth`
  to the API (`API_URL`, default `http://127.0.0.1:3000`), so open the page at
  **http://127.0.0.1:5173**, not `localhost`. Each new API area (for example `/projects`) is added
  to the list in `apps/web/src/lib/dev-proxy.ts`, and the same list becomes the reverse-proxy rule
  in production. Because of this, `/auth` is reserved: no page may use that address.
- **Keep the path.** The proxy forwards paths unchanged. Do not mount the API under a prefix such
  as `/api`: the development refresh cookie is limited to `Path=/auth`.
- **A 401 from `/auth/refresh` is not always "signed out".** A tab that loses a refresh race gets a
  401 although another tab just renewed the login. `lib/auth/session-manager.ts` waits 300 ms and
  retries once (re-reading the cookie) before it signs out.
- **No body on refresh and logout.** `lib/api/auth-api.ts` sends `POST /auth/refresh` and
  `/auth/logout` with no body and no content type.
- **The access token lives in a variable** (`lib/auth/token-store.ts`), never in `localStorage`,
  `sessionStorage` or IndexedDB. A page reload restores it from the refresh cookie. The session
  manager renews it a minute before it expires, and `withAuth` renews it once and retries once
  when a call gets a 401.
- **The CSRF code** is read from `csrf_token` or `__Host-csrf_token` (`lib/auth/csrf-cookie.ts`)
  and copied into `X-CSRF-Token`. Its absence means "not signed in": no refresh request is sent.

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
