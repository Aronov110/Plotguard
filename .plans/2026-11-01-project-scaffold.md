Status: done (2026-11-01)

# Step 0: Project scaffold

Outcome notes:
- All checks passed: Biome, `tsc` strict, 23 tests, API `/health`, web production build.
- Postgres 17.5 container healthy. On the author's machine a native PostgreSQL already uses port
  5432, so the local `.env` sets `POSTGRES_PORT=5433`. The committed default stays 5432.
- `tsx` was dropped: Node >= 24 runs `.ts` natively (`erasableSyntaxOnly` enforces compatible syntax).

Plotpal is an app that helps writers of scripts and stories find plot holes and get ideas with AI.
Users sign up and sign in; their work is stored in a database.

## Decisions (approved 2026-11-01)

| Category        | Choice                                                                                |
| --------------- | ------------------------------------------------------------------------------------- |
| Language        | TypeScript strict, no `any`                                                           |
| Package manager | bun (workspaces), single lockfile `bun.lock`                                          |
| Frontend        | React + Vite, Atomic Design                                                           |
| Backend         | Fastify + Zod, OpenAPI-first, docs via Scalar (later step)                            |
| Database        | PostgreSQL in Docker, Drizzle ORM + drizzle-kit migrations (young tool, flagged)      |
| Auth            | Hand-rolled: argon2id, access token in memory, refresh token in httpOnly cookie, CSRF |
| AI              | Claude API via Anthropic SDK, backend only (Step 5)                                   |
| Tests           | Vitest, React Testing Library, Playwright, axe                                        |
| Lint/format     | Biome                                                                                 |

Product decisions:
- Projects have a `format` (screenplay / prose / other) chosen by the user at creation.
- Editor layout: outline | writing area | collapsible AI panel.
- AI scope is chosen per run: current chapter/scene or whole story, with a cost hint and per-user limits.
- Theme follows the system setting.
- Email verification and password reset come after the core auth works.
- `.plans/` is committed.

## Roadmap

0. Scaffold (this plan)
1. Database schema and migrations
2. Auth backend
3. Auth frontend
4. Writing core (projects, documents, editor)
5. AI features (plot-hole finder, idea generator)
6. Hardening (OWASP review, Lighthouse, Dockerfiles, CI)

## Step 0 scope

Root: package.json, tsconfig.base.json, biome.json, .gitattributes, .gitignore,
.env.example, docker-compose.yml, README.md, .plans/.
apps/api: Fastify app with /health, Zod-validated env config, tests.
apps/web: Vite + React shell with Atomic Design folders, design tokens, smoke test.

Out of scope: app Dockerfiles, CI, security headers/CORS, Storybook, any schema.

## Test plan

- GET /health returns 200 and `{ status: "ok" }`.
- Env config rejects missing, empty and malformed values; accepts valid ones.
- Web smoke test renders the home page with a main landmark and a heading.
- Biome and `tsc` pass in both apps.

## Security and accessibility notes

- `.env` is gitignored; only `.env.example` with fake values is committed.
- Postgres is bound to 127.0.0.1 only, with a pinned image version and a healthcheck.
- Web shell has `lang`, viewport meta, a landmark layout and a visible focus style.

## Risks

- Node release line may not be LTS; `engines` is pinned accordingly.
- Drizzle is a relatively young ORM; Prisma is the mature alternative.
