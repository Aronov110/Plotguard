Status: approved (2026-11-02). All ten proposed decisions (D1 to D10) accepted as recommended, two-PR split
accepted, and the local `.env` may get a generated `JWT_ACCESS_SECRET` appended.

PR B1 (`feat/auth-backend`): done (2026-11-02), pending review and commit. PR B2 (`feat/auth-routes`): not started.

## PR B1 outcome notes

- Checks: Biome and `tsc` clean; 631 unit tests (was 362) and 276 integration tests (was 138).
- argon2 installs and runs on this machine (Windows, Node 26): about 42 ms per hash with the default
  settings. musl (Alpine) prebuilds are still to be checked for the Step 6 Docker image.
- `.env` received a generated 64-character `JWT_ACCESS_SECRET` (gitignored, never printed).
- Deviations from the plan, all found by tests or the compiler:
  - `loadDatabaseEnv` added: the migration CLI shares the env loader, and must not demand auth secrets.
  - `REFRESH_REUSE_GRACE_SECONDS` is parsed with a digits-only regex instead of `z.coerce`: an empty
    value coerced to 0 and silently switched the grace window off.
  - The API's `tsconfig.json` raises `target`/`lib` to ES2024 (`String.isWellFormed`,
    `Promise.withResolvers`; Node 24+ has both). The shared base file and the web app are unchanged.
  - New small modules beyond the plan: `auth/credentials.ts` (email and display-name rules),
    `db/pg-errors.ts` (recognise a unique violation inside a Drizzle error), `ServiceBusyError` (503).
  - Access-token verification adds a strict "three URL-safe parts" check, because jose tolerates
    whitespace around a token and we never issue one.
  - An empty password reports "too short" (the whitespace rule needs at least one character).
- Behaviour worth knowing for B2:
  - Login refuses a password that fails the policy without hashing it (every stored password passed it).
  - A failed hash upgrade after login does not fail the login; it goes to `onError`.
  - Logout revokes the whole login family, whichever token of the family it is given.
  - `onSecurityEvent` fires only for refresh reuse; B2 wires it to a `warn` log line.
  - The service exposes `identifyRefreshToken` and `verifyCsrf`, so the B2 guard can check the CSRF
    code against the family of the cookie's token before rotating anything.
  - Emails are printable ASCII only for now (JavaScript and Postgres lower-case some characters
    differently). Internationalised addresses are a later decision.
- Test corrections, not bent: a signature-tampering test flipped the last base64url character, whose
  two padding bits sometimes do not change the decoded signature, so it failed randomly. It now changes
  the first character.

# Step 2b: Auth backend

Sign-up, login, token refresh, logout and "who am I" for the API, on top of the foundation (#4) and the
hardening (#5). Two PRs, so each stays reviewable:

- **PR B1 `feat/auth-backend`:** everything that is not HTTP. Env changes, password hashing, access
  tokens, refresh sessions in the database, CSRF token derivation, the auth service. Fully tested,
  no routes.
- **PR B2 `feat/auth-routes`:** the five routes, cookies, Origin and CSRF guards, per-route rate
  limits, `requireAuth`, OpenAPI docs, security-event logging, CORS and cache headers.

## Decisions already made (2026-11-02)

- Password hashing: `argon2` (node-argon2), argon2id.
- `POST /auth/register` on a duplicate email: 409 Conflict.
- CSRF for cookie-authenticated endpoints: Origin allowlist + double-submit token.
- Access token in memory (response body), refresh token in an httpOnly cookie, never tokens in
  localStorage.

## Decisions proposed here (please confirm or change)

| #   | Decision                                                                                                                   | Recommended |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ----------- |
| D1  | Access token: JWT, HS256, 15 min, via `jose`                                                                               | yes         |
| D2  | Refresh token: 32 random bytes, only its SHA-256 stored, rotated on every use, sliding 30 days, absolute cap 90 days       | yes         |
| D3  | Reuse detection with a 10 s grace window (a second tab refreshing at the same moment is not an attack)                     | yes         |
| D4  | CSRF token = HMAC of the session family id (signed double-submit), sent as cookie and `X-CSRF-Token` header                | yes         |
| D5  | Origin header required and allowlisted on all four state-changing auth POSTs (also login and register, to stop login CSRF) | yes         |
| D6  | Per-IP route limits plus a per-email limiter on login                                                                      | yes         |
| D7  | A cap of 4 concurrent password hashes (queue limit 50) so a burst cannot exhaust memory and threads                        | yes         |
| D8  | Request bodies on auth routes limited to 4 KiB; unknown JSON fields rejected                                               | yes         |
| D9  | `NODE_ENV` becomes required (no default); cookie `Secure` is on exactly when it is `production`                            | yes         |
| D10 | Password policy: 12 to 128 characters, NFKC-normalised, no composition rules, no NUL, not only whitespace                  | yes         |

## Endpoints

All under `/auth`. Every response has `Cache-Control: no-store`. Errors are Problem Details.

| Route                 | Auth                                     | Success                                          | Notable errors                           |
| --------------------- | ---------------------------------------- | ------------------------------------------------ | ---------------------------------------- |
| `POST /auth/register` | Origin                                   | 201 `{ user, accessToken, expiresIn }` + cookies | 400, 403, 409, 413, 415, 429             |
| `POST /auth/login`    | Origin                                   | 200 same shape + cookies                         | 400, 401 (one generic message), 403, 429 |
| `POST /auth/refresh`  | Origin + refresh cookie + `X-CSRF-Token` | 200 same shape + rotated cookies                 | 401 (cookies cleared), 403, 429          |
| `POST /auth/logout`   | Origin + refresh cookie + `X-CSRF-Token` | 204, cookies cleared, idempotent                 | 403, 429                                 |
| `GET /auth/me`        | `Authorization: Bearer`                  | 200 `{ user }`                                   | 401 with `WWW-Authenticate`              |

`user` is `{ id, email, displayName }`. The password hash is never returned or logged.

### Cookies

| Cookie          | Value                | Flags                                                                                                              |
| --------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `refresh_token` | opaque 43-char token | HttpOnly, SameSite=Strict, Path=/auth, Max-Age=30 d, Secure in production                                          |
| `csrf_token`    | HMAC of family id    | readable by JS (the SPA must copy it into the header), SameSite=Strict, Path=/, Max-Age=30 d, Secure in production |

No `Domain` attribute, so the cookies stay host-only. The CSRF cookie needs `Path=/` because
`document.cookie` only shows cookies whose path matches the page.

### Refresh rotation (atomic, no race)

1. `UPDATE refresh_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now() RETURNING user_id, family_id`. Exactly one concurrent request wins.
2. Winner inserts the next token in the same family (expiry = min(now + 30 d, family start + 90 d)), in the same transaction.
3. A loser looks the token up: unknown or expired gives 401; revoked less than 10 s ago gives 401 without revoking anything; revoked longer ago is reuse, so the whole family is revoked, a security event is logged, and the answer is 401.

### Dev note (recorded here, acted on in Step 3)

`localhost` and `127.0.0.1` are different sites, so a `SameSite=Strict` cookie is not sent between them.
In development the web app and the API must be reached through the same hostname, or better, the Vite dev
server proxies `/api` so the browser sees one origin. Never reach for `SameSite=None`.

## Env additions (Zod-validated, errors never echo values)

- `NODE_ENV`: required, no default (D9).
- `JWT_ACCESS_SECRET`: at least 32 characters; in production the `.env.example` placeholder is rejected.
- `ACCESS_TOKEN_TTL_SECONDS` (default 900, 60 to 3600), `REFRESH_TOKEN_TTL_DAYS` (default 30, 1 to 90),
  `REFRESH_REUSE_GRACE_SECONDS` (default 10, 0 to 60).
- `.env.example` gets a placeholder secret with the generation command (`openssl rand -base64 48`).
  Your local `.env` needs a real value: you run the command, or approve me appending it.

## Files

New dependencies, exact versions, bun only: `argon2` 0.45.1, `jose` 6.2.15, `@fastify/cookie` 11.1.5.

PR B1 (`apps/api/src`): `config/env.ts` (changed), `auth/password.ts`, `auth/tokens.ts`,
`auth/sessions.ts`, `auth/users.ts`, `auth/service.ts`, `auth/hash-gate.ts`, tests beside them in
`__tests__/`, `.env.example`, `README.md`.

PR B2: `routes/auth.ts`, `auth/schemas.ts`, `auth/cookies.ts`, `auth/origin-guard.ts`,
`auth/csrf-guard.ts`, `auth/require-auth.ts`, `plugins/security.ts` (CORS header, security-event hook),
`errors/error-handler.ts` (warn on 401, 403, 429), `app.ts` (register routes, cookie plugin).

No barrel files. No schema or migration changes: the existing tables already fit.

## Test plan (tests first; edge cases included)

**Passwords:** lengths 11 / 12 / 128 / 129; emoji and multi-byte characters; NFKC equivalence (composed
and decomposed forms verify against each other); NUL rejected; 12 spaces rejected; hash starts with
`$argon2id$v=19$m=19456,t=2,p=1$`; wrong password is false; a malformed hash returns false, never throws;
`needsRehash` is true for weaker parameters and login upgrades the stored hash; the dummy hash is verified
for unknown emails; the hash gate releases its slot on errors, queues up to the limit, and rejects beyond it.

**Access tokens:** round trip with all claims (`iss`, `aud`, `sub`, `iat`, `exp`); expired (injected
clock); issued in the future; `alg: none`; HS512 signed with the same secret; RS256 header (algorithm
confusion); tampered payload; tampered signature; truncated; empty; four segments; wrong issuer or
audience; missing or non-UUID `sub`; signed with another secret; token over 4 KiB rejected before parsing.

**Refresh tokens and CSRF:** length 43, unique over 10,000 draws, hash is 64 lowercase hex and
deterministic; CSRF value is stable per family, differs per family and per secret; comparison is
constant-time and tolerates wrong lengths and non-ASCII without throwing.

**Env:** `NODE_ENV` missing fails; secret 31 vs 32 characters; placeholder rejected in production only;
TTL range edges; messages never contain the secret.

**Sessions (real database):** create, rotate, revoke; 10 concurrent rotations of one token give exactly
one winner and, inside the grace window, no family revocation; after the grace window (revoked_at moved
back in the database) reuse revokes the family and the newest token stops working; expired token; absolute
cap respected; user deleted cascades; family ids isolate users.

**Routes (real database, PR B2):**
- Register: cookie flags exactly as above (Secure only in production); stored hash is argon2id; email
  trimmed and lowercased; duplicate in a different case gives 409; two simultaneous identical
  registrations give one 201 and one 409, never a 500; non-ASCII email gives 400 (JS and Postgres
  lower-casing differ for some characters); 255-character email; display name 80 / 81 characters,
  control characters, whitespace only; unknown field gives 400; body over 4 KiB gives 413; `text/plain`
  gives 415; missing or foreign `Origin` gives 403.
- Login: wrong password and unknown email give identical status, body and headers; case-insensitive email;
  per-IP and per-email limits give 429 with `Retry-After`; a second login makes a new family.
- Refresh: success rotates and the old token is dead; missing, malformed, over-long and unknown cookies
  give 401 and clear both cookies; CSRF header missing, wrong, or from another family gives 403; Origin
  missing or foreign gives 403; user deleted gives 401.
- Logout: revokes the session, is idempotent, works with no cookie, clears cookies with the same
  attributes, leaves other families alone, and the next refresh fails.
- Me: valid token; no header; `Bearer` alone; lower-case `bearer`; `Basic`; double spaces; expired;
  deleted user; the response never contains the hash.
- Cross-cutting: every `/auth/*` response has `Cache-Control: no-store` and the helmet headers; CORS
  preflight accepts `X-CSRF-Token`; 401, 403 and 429 are logged at warn without credentials; a sentinel
  password, email and token never appear in the logs of any flow; the OpenAPI document lists the five
  routes, the bearer scheme and the cookie behaviour; existing 362 unit and 138 integration tests stay green.

## Security and accessibility notes

- OWASP A01 (every protected route goes through `requireAuth`), A02 (argon2id, HMAC, SHA-256, random
  tokens), A04 (rate limits, hash gate, size limits), A07 (generic login errors, reuse detection, CSRF),
  A09 (security events, no credentials in logs).
- The `security-reviewer` agent runs on the finished PR B2 before it opens, like last time.
- Error `detail` strings are written to be shown directly in the Step 3 forms and are plain text only.

## Alternatives and risks

- **Library or opaque DB-backed access tokens:** rejected earlier (hand-rolled auth was decided; the
  JWT keeps requests off the database). Consequence: a leaked access token works for up to 15 minutes
  after logout. Accepted.
- **HS256 vs EdDSA:** one service signs and verifies, so a shared secret is enough. Asymmetric keys when
  a second service needs to verify.
- **argon2 install risk:** it ships prebuilt binaries, but I will check it installs on Windows with
  Node 26 before relying on it, and confirm musl builds exist for the Step 6 Docker image. Fallback:
  `@node-rs/argon2` (same API shape, not the same code).
- **Per-email limiter lets someone lock a victim out of login for 15 minutes.** The alternative (no
  per-email limit) lets distributed guessing through. Recommended: keep it, count only login attempts.
- **Grace window:** ten seconds is a guess; it is a constant and tested at its edges.
- **In-memory rate limits** are per process, as before. A shared store comes with scaling out.
- **Absolute session cap** costs one extra indexed query per refresh. Accepted.
- **Email enumeration** through the 409 is accepted for now and rate limited.
- **Required `NODE_ENV`** makes an old local `.env` without it fail at startup with a clear message.

## Deferred

Email verification and password reset (after core auth works), breached-password check, logout from
all devices, cleanup job for expired sessions, `TRUST_PROXY` and the IPv6 /64 key (Step 6), gating
`/docs` (Step 6), key rotation for the signing secret.
