Status: done (2026-11-02), merged in PR #4

# Step 2a: API foundation

Outcome notes:
- Checks: Biome and `tsc` clean; 167 unit tests and 133 integration tests pass; smoke-tested over real
  HTTP (Problem Details, CSP on API vs /docs/, CORS allowlist, clean shutdown).
- Deviations from the plan, all found by tests:
  - Env var is `RATE_LIMIT_WINDOW_SECONDS` (not `RATE_LIMIT_WINDOW`) so the unit is explicit.
  - Unknown URLs are rate limited too (`setNotFoundHandler` with `app.rateLimit()`, per the plugin docs).
    The not-found handler therefore lives in `registerSecurity`; Fastify allows only one per instance.
  - Log redaction uses wildcard header paths (`headers`, `*.headers`, `*.*.headers`). The first idea,
    `req.headers.*`, could never match because Fastify serializes `req`/`res` without headers.
  - `/docs` redirects to `/docs/` (Scalar behaviour).
  - For a disallowed Origin, @fastify/cors omits only Access-Control-Allow-Origin and still echoes its
    static Allow-Credentials / Allow-Methods. Harmless without Allow-Origin, so tests assert only that.
- Follow-ups, not done here:
  - Fastify logs the full request URL including the query string. Never put secrets in query strings
    (reset and verify tokens go in the body or the path fragment), or add a URL serializer in Step 2b/6.
  - `/docs` and `/docs/openapi.json` are public. Gate or disable in production in Step 6.
  - Rate-limit store is in memory (per process); needs a shared store when the API scales out.
  - The OpenAPI `info.version` is a hard-coded "0.0.0".
  - Body limit is 1 MiB for every route; large manuscript saves in Step 4 will need a per-route limit.

First of two PRs for Step 2 (Auth backend). This one adds the shared plumbing; the auth endpoints
follow in Step 2b (`feat/auth-backend`).

## Decisions (approved 2026-11-02)

- Password hashing (Step 2b): `argon2` (node-argon2).
- `POST /auth/register` on a duplicate email: 409 Conflict (uniform response once email verification exists).
- CSRF for refresh/logout (Step 2b): Origin allowlist + double-submit token.
- Two PRs: this foundation first, auth endpoints second.

## Scope

- Errors: `AppError` base class and subclasses (`ValidationError`, `UnauthorizedError`,
  `ForbiddenError`, `NotFoundError`, `ConflictError`, `RateLimitError`) in `src/errors/`.
  One global error handler returns RFC 9457 `application/problem+json`. Unknown errors become a
  generic 500 that is logged but never leaks details. Not-found route handler also uses Problem Details.
- Validation + docs: `fastify-type-provider-zod` (Zod schemas drive validation and OpenAPI),
  `@fastify/swagger` for the spec, `@scalar/fastify-api-reference` for docs at `/docs`.
- Security plugins: `@fastify/helmet`, `@fastify/cors` (allowlist from env, credentials on),
  `@fastify/rate-limit` (global default, Problem Details on 429 with `Retry-After`).
- Env additions (Zod-validated): `CORS_ORIGINS` (comma-separated, each a valid origin, no wildcard),
  `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS`. Auth secrets/TTLs arrive in Step 2b where they are used.
- Logging: pino redaction of `authorization` and `cookie` headers.
- `buildApp` takes a database client so Step 2b can use it; `/health` stays unchanged.

Out of scope: auth endpoints, tokens, cookies, CSRF (Step 2b); Dockerfiles, CI (Step 6).

## New dependencies (exact versions pinned, bun only)

`fastify-type-provider-zod` 7.0.0, `openapi-types` (peer), `@fastify/swagger` 9.9.3,
`@scalar/fastify-api-reference` 1.76.4, `@fastify/helmet` 13.2.0, `@fastify/cors` 11.4.0,
`@fastify/rate-limit` 11.2.1. Peer ranges checked against fastify 5.12.7 and zod 4.6.7.
`fastify-type-provider-zod` and the Scalar plugin are community/vendor packages rather than core
Fastify plugins; flagged for the review.

## Test plan

- Error classes: status, `type`, `title`, `detail` mapping; `instance`; subclass `instanceof` chains.
- Handler: every `AppError` becomes valid Problem Details with the right status and content type;
  validation errors list per-field issues without echoing values; unknown errors give a generic 500
  with no stack or message; 404 and 405-style routes; malformed JSON body; oversized body (413);
  unsupported content type (415).
- Env: `CORS_ORIGINS` rejects `*`, empty entries, malformed origins and paths; trims whitespace;
  defaults in development; rate-limit values reject zero, negative and non-numeric input.
- CORS: allowed origin gets headers; disallowed origin gets none; preflight; credentials header;
  no wildcard ever returned.
- Helmet: key security headers present on normal and error responses.
- Rate limit: requests over the limit get 429 Problem Details with `Retry-After`.
- OpenAPI: generated spec is valid, `/docs` serves, `/health` is documented.
- Logging: authorization and cookie headers never appear in log output.
- Regression: existing unit and integration tests, Biome and `tsc` stay green.

## Security and accessibility notes

- OWASP A05 (misconfiguration): helmet defaults, CORS allowlist, no stack traces in responses.
- OWASP A04/A07: rate limiting baseline; stricter per-route limits come with auth routes.
- OWASP A09: redaction of sensitive headers in logs.
- `/docs` should be disabled or protected in production; decision recorded in the Step 6 hardening plan.
- No UI in this PR. Problem Details `detail` strings are written to be shown to users in Step 3 forms.

## Risks

- Scalar's helmet CSP: the docs page needs a relaxed CSP on `/docs` only; scope that narrowly.
- Rate limiting by IP behind a proxy needs `trustProxy`; not enabled until deployment (Step 6).
