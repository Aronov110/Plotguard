import {
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

const ISSUER = "plotpal-api";
const AUDIENCE = "plotpal-web";
const TOKEN_TYPE = "at+jwt";
/** A real token is about 250 characters. Anything near this size is an attack, not a login. */
const MAX_TOKEN_LENGTH = 2048;
/** How far this server's clock and the clock that made the token may disagree. */
const CLOCK_TOLERANCE_SECONDS = 5;
const MIN_SECRET_LENGTH = 32;
const COMPACT_JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertSecret(secret: string): void {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new RangeError(`The secret must be at least ${MIN_SECRET_LENGTH} characters`);
  }
}

export interface AccessTokenOptions {
  readonly secret: string;
  readonly ttlSeconds: number;
  /** The clock. Tests replace it to move time. */
  readonly now?: () => Date;
}

export interface SignedAccessToken {
  readonly token: string;
  readonly expiresIn: number;
}

export interface AccessTokens {
  sign(userId: string): Promise<SignedAccessToken>;
  /** The user id for a valid token, `undefined` for anything else. The reason is never revealed. */
  verify(token: string): Promise<{ userId: string } | undefined>;
}

/**
 * Short-lived signed passes (JWT, HS256). The token holds only the user id: no email, no name.
 * Verification accepts exactly one algorithm, one issuer, one audience and one token type, and
 * insists on an expiry that is not longer than the lifetime this server issues.
 */
export function createAccessTokens(options: AccessTokenOptions): AccessTokens {
  assertSecret(options.secret);
  const { ttlSeconds } = options;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1) {
    throw new RangeError("ttlSeconds must be a whole number of at least 1");
  }
  const key = new TextEncoder().encode(options.secret);
  const now = options.now ?? (() => new Date());
  const nowSeconds = () => Math.floor(now().getTime() / 1000);

  return {
    async sign(userId) {
      if (!UUID_PATTERN.test(userId)) throw new TypeError("userId must be a UUID");
      const issuedAt = nowSeconds();
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: "HS256", typ: TOKEN_TYPE })
        .setSubject(userId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setJti(randomUUID())
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + ttlSeconds)
        .sign(key);
      return { token, expiresIn: ttlSeconds };
    },

    async verify(token) {
      if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
        return undefined;
      }
      // Exactly three URL-safe parts. jose is lenient about whitespace; we issue none, so allow none.
      if (!COMPACT_JWT_PATTERN.test(token)) return undefined;
      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: ["HS256"],
          issuer: ISSUER,
          audience: AUDIENCE,
          typ: TOKEN_TYPE,
          currentDate: now(),
          clockTolerance: CLOCK_TOLERANCE_SECONDS,
          requiredClaims: ["sub", "iat", "exp"],
        });
        const { sub, iat, exp } = payload;
        if (typeof sub !== "string" || !UUID_PATTERN.test(sub)) return undefined;
        if (typeof iat !== "number" || typeof exp !== "number") return undefined;
        if (iat > nowSeconds() + CLOCK_TOLERANCE_SECONDS) return undefined;
        if (exp - iat > ttlSeconds) return undefined;
        return { userId: sub };
      } catch {
        return undefined;
      }
    },
  };
}

const REFRESH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** 32 random bytes, written as 43 URL-safe characters. Only its hash is ever stored. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 as 64 lowercase hex characters: what the `refresh_sessions.token_hash` column holds. */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A cheap shape check, so garbage from a cookie never reaches the database. */
export function isWellFormedRefreshToken(token: string): boolean {
  return REFRESH_TOKEN_PATTERN.test(token);
}

export interface CsrfTokens {
  /** The token for a login family. The same family always gives the same token. */
  derive(familyId: string): string;
  /** True only for the exact token of that family. Never throws, whatever it is given. */
  verify(familyId: string, candidate: string | undefined): boolean;
}

/**
 * The CSRF handshake code: an HMAC of the login family id, under a key derived from the server
 * secret for this one purpose. Nothing is stored. A page on another site cannot read the cookie
 * that carries it, so it cannot copy it into the `X-CSRF-Token` header.
 */
export function createCsrfTokens(secret: string): CsrfTokens {
  assertSecret(secret);
  const key = Buffer.from(hkdfSync("sha256", secret, "", "plotpal csrf token v1", 32));
  const derive = (familyId: string): string =>
    createHmac("sha256", key).update(familyId).digest("base64url");

  return {
    derive,
    verify(familyId, candidate) {
      if (typeof candidate !== "string") return false;
      const expected = Buffer.from(derive(familyId));
      const given = Buffer.from(candidate);
      return given.byteLength === expected.byteLength && timingSafeEqual(given, expected);
    },
  };
}
