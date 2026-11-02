Status: done (2026-11-02), pending review and commit. Decisions: preflight counting via an OPTIONS-only
limiter hook (fallback: leave preflights unmetered and document it, never swap the order); query-string
stripping stays in this PR; the deferred list is accepted as written.

Outcome notes:
- Checks: Biome and `tsc` clean; 362 unit tests (was 167), 138 integration tests (was 133), 3 web tests.
- The scratch script that confirmed #1, #5, #6, #7 was re-run against the fixed app: docs and preflights
  now return 429 over the limit, `/%zz` is Problem Details with nosniff, `text/plain` is 415.
- The fallback for preflights was not needed: the OPTIONS-only hook works and counts each request once.
- Why preflights escaped before: the global limiter is a route-level hook (added by `onRoute`), while
  `@fastify/cors` is an app-level hook that answers preflights and ends the request first. For the same
  reason a 429 on a normal request still carries the CORS headers.
- Fastify types force `err` serializers to return `stack: string` and `req` serializers optional keys,
  so the serializers return `stack: ""` when there is none and omit missing request fields.
- Test premises that were wrong and were corrected, not bent: the unique constraint is
  `users_email_unique` (not `_key`); the foreign-key test needed a future `expires_at` and a 64-hex
  `token_hash` so that the foreign key, not an earlier CHECK, is what fails.
- Class 22 (data exception) messages quote the value (`invalid input syntax for type uuid: "..."`),
  so their message is replaced and only the SQLSTATE is kept. Allowlisted classes: 08, 23, 28, 3D, 40,
  42, 53, 57.
- Redaction now has about 150 wildcard paths. If log throughput ever matters, measure it before adding more.

# Step 2a-fix: API hardening

Follow-up to PR #4 (API foundation), driven by the `security-reviewer` report on commit `c60528a`.
It lands before Step 2b so the auth endpoints are built on a solid base. No new endpoints.

Reviewer numbering is kept (#1 ... #12) so findings can be traced.

## Verified before planning

Reproduced against the merged code with a scratch script (not committed):

| #   | Claim                                | Result                                                                               |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------ |
| 1   | `/docs/*` is outside the rate limit  | Confirmed: 5/5 requests returned 200 with the limit at 2                             |
| 1   | `/docs/*` has no helmet headers      | **Wrong**: nosniff, referrer-policy and HSTS are present                             |
| 2   | 5xx logging can write SQL parameters | Confirmed in source: `DrizzleQueryError.message` is `Failed query: ...\nparams: ...` |
| 5   | `/%zz` bypasses Problem Details      | Confirmed: plain `application/json`, quotes the path, no nosniff                     |
| 6   | `text/plain` reaches handlers        | Confirmed: 200 on a route without a body schema                                      |
| 7   | CORS preflights are not rate limited | Confirmed: 6/6 `OPTIONS` returned 204 with the limit at 2                            |

## Scope (this PR)

1. **Rate limit covers `/docs/*` (#1).** Register `registerSecurity` before `registerOpenApi` in
   `app.ts`. Swagger only needs to precede the routes. Fix the misleading comment there.
2. **Preflights are counted (#7).** An `OPTIONS`-only limiter hook registered before `@fastify/cors`
   (which answers preflights itself in `onRequest` and ends the request). Normal requests keep the
   current order (cors first), so a 429 still carries CORS headers if Fastify keeps headers set before
   an error. Details settled with tests; see Decisions.
3. **Pre-routing errors become Problem Details (#5).** `frameworkErrors` option in `buildApp`, reusing
   the existing mapping. Fixed detail strings for `FST_ERR_BAD_URL` and `FST_ERR_MAX_PARAM_LENGTH`.
   The handler runs before any hook, so it sets `x-content-type-options: nosniff` itself and omits
   `instance` (it would be the invalid raw path).
4. **Only JSON bodies (#6).** `app.removeContentTypeParser("text/plain")`. Routes that take no body
   (refresh, logout) are unaffected.
5. **Safe error logging (#2).** A custom pino `err` serializer: walks the `cause` chain (depth-limited,
   cycle-safe), keeps type, SQLSTATE `code`, `constraint`, `table`, `severity`, the query text (it
   contains `$1` placeholders, not values) and a stack rebuilt from a sanitized message. Drops
   `params`, `detail` and `where`. A real-database integration test is the tripwire for a Drizzle
   upgrade that changes the error shape.
6. **Wider redaction (#8).** Add `proxy-authorization`, `x-api-key`, `api-key`, `x-auth-token`; match
   capitalised header keys; add body-field paths `password`, `newPassword`, `currentPassword`,
   `passwordHash`, `token`, `accessToken`, `refreshToken` at depth 0 to 2.
7. **No query strings in logs (recorded follow-up).** A `req` serializer that logs method, path
   (query removed), host, remote address. Fastify's default serializer logs the full URL.
8. **Stricter `CORS_ORIGINS` (#10).** Reject `*` and `\` anywhere in an entry; in production require
   `https://` for every origin. Default-port and case normalisation stays (it is harmless).
9. **Reflected strings (#11, partial).** Cap `instance` at 200 characters. Rule for Step 3: the
   frontend renders `detail` and `errors[].message` as text, never HTML.

## Deferred (not in this PR)

| Item                                                                                                             | Goes to                                            |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| #3 validated `TRUST_PROXY` setting, required in production; IPv6 /64 rate-limit key                              | Step 6 hard prerequisite, mentioned in the 2b plan |
| #4 `NODE_ENV` without a default (decide together with the cookie `Secure` flag)                                  | Step 2b plan                                       |
| #9 `X-CSRF-Token` in CORS `allowedHeaders`, `Cache-Control: no-store` on `/auth/*`, one dev hostname for cookies | Step 2b                                            |
| #12 security-event logging (401, 403, 429 at warn, no credentials)                                               | Step 2b                                            |
| Small body limit and password `max()` on auth routes (argon2 CPU)                                                | Step 2b                                            |
| Gate or disable `/docs` outside local development                                                                | Step 6                                             |

## Files

Changed: `apps/api/src/app.ts`, `plugins/security.ts`, `errors/error-handler.ts`, `config/logger.ts`,
`config/env.ts`, `.env.example` (note: https required in production), `README.md` if needed.

New: `config/log-serializers.ts` (err and req serializers), tests below.

## Test plan (tests first, edge cases included)

- **Docs coverage:** `/docs/`, `/docs/openapi.json`, `/docs/openapi.yaml` carry helmet headers, keep the
  relaxed docs CSP (not the deny-all one), and return 429 Problem Details over the limit. `/health`
  stays exempt. The OpenAPI spec still lists the real routes (guards the registration order).
- **Preflight:** counted per client; allowed preflight under the limit still gets 204 with its
  headers; over the limit gets 429; disallowed-origin preflight is counted too; separate IPs have
  separate budgets; a 429 for an allowed Origin keeps `Access-Control-Allow-Origin` (or the test records
  that it cannot, and we document the SPA consequence).
- **Framework errors:** `/%zz`, truncated escapes (`/%E0%A4%A`), `/%00`, an over-long path parameter
  (expect 414) give Problem Details with `nosniff`, a fixed detail, and no reflected input.
- **Content types:** `text/plain` gives 415 with and without a body schema; JSON (with and without
  charset) still works; a POST with no body and no content type still works; form-urlencoded and
  multipart stay 415.
- **`instance` cap:** a 5,000-character unknown path gives `instance` of at most 200 characters.
- **Error serializer (unit):** `DrizzleQueryError` with a sentinel parameter leaves no sentinel in
  message, stack or any field; query placeholders and SQLSTATE survive; `detail` and `where` dropped;
  cause chain depth limit; circular `cause`; thrown string, `null`, plain object and `AggregateError`
  do not crash the logger.
- **Error logging (integration, real database):** a failing insert (lowercase-email CHECK) with a
  sentinel value logs SQLSTATE `23514` and the constraint name but not the sentinel; the client gets a
  generic 500.
- **Redaction:** each new header and body-field path, capitalised variants, depth 0, 1 and 2; harmless
  fields (for example `accept`) stay readable.
- **Request serializer:** `?token=SENTINEL&x=1` never appears in logs for normal requests, 404s and
  errors; method, path, host and remote address stay.
- **Env:** `*`, `http://*.example.com`, `http://good.com\evil` rejected; `https://a.example.com:443`
  still normalised; production rejects any `http://` origin (single and mixed lists), accepts https;
  development accepts http; error messages never echo values.
- **Regression:** existing 167 unit and 133 integration tests, Biome and `tsc` stay green. Existing
  tests change only if their premise changes, and the summary will say which.

## Security and accessibility notes

- OWASP A04 (unthrottled endpoints), A05 (misconfiguration), A09 (sensitive data in logs).
- No UI. The only accessibility-adjacent rule is the Step 3 note about rendering error text safely.
- Allowlist serializer: unknown future error types keep type, code and stack; only the known
  DB-error shapes get field-level filtering, so new libraries need a review when adopted.

## Alternatives and risks

- **Preflight counting.** (a) OPTIONS-only limiter hook before cors (planned); (b) register rate limit
  before cors for everything, simpler but 429s then lose CORS headers and the SPA sees an opaque
  network error; (c) leave preflights unmetered and document it (reviewer rated this low). If (a) turns
  out fragile, fall back to (c), not (b).
- **`frameworkErrors` runs before hooks**, so malformed-URL responses get no helmet, CORS or rate-limit
  handling. They are tiny and static; only `nosniff` is added by hand.
- **Drizzle upgrades** may change the error shape. The real-database test fails loudly if so.
- **Removing `text/plain`** means a later feature that wants text bodies must add a parser on purpose.
