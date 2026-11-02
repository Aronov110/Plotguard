import { randomUUID } from "node:crypto";
import type { Database } from "../db/client.ts";
import {
  ConflictError,
  type ProblemIssue,
  UnauthorizedError,
  ValidationError,
} from "../errors/app-error.ts";
import {
  checkDisplayName,
  checkEmail,
  type DisplayNameIssue,
  normalizeDisplayName,
  normalizeEmail,
} from "./credentials.ts";
import { checkPasswordPolicy, PASSWORD_ISSUE_MESSAGES, type PasswordHasher } from "./password.ts";
import { createSession, findLiveSession, revokeFamilyByToken, rotateSession } from "./sessions.ts";
import {
  type AccessTokens,
  type CsrfTokens,
  generateRefreshToken,
  hashRefreshToken,
  isWellFormedRefreshToken,
} from "./tokens.ts";
import {
  createUser,
  EmailTakenError,
  findUserByEmail,
  findUserById,
  type PublicUser,
  toPublicUser,
  updatePasswordHash,
} from "./users.ts";

/** One message for every failed login, so the answer never says which half was wrong. */
const INVALID_CREDENTIALS = "Invalid email or password.";
const SESSION_EXPIRED = "Your session has expired. Sign in again.";
/** Far longer than any allowed password, so a huge value is refused before it is normalised. */
const MAX_LOGIN_PASSWORD_UNITS = 4096;

const DISPLAY_NAME_MESSAGES: Readonly<Record<DisplayNameIssue, string>> = {
  "too-short": "Enter at least 1 character, or leave the name out.",
  "too-long": "Use at most 80 characters.",
  "control-character": "Remove tabs, line breaks and other control characters.",
  "malformed-unicode": "The name contains characters that are not valid text.",
};

export interface AuthServiceConfig {
  readonly refreshTtlDays: number;
  /** A login ends after this many days however often it is renewed. */
  readonly refreshAbsoluteDays: number;
  readonly refreshGraceSeconds: number;
}

/** Things worth a security log line. Never contains credentials. */
export type SecurityEvent = { type: "refresh-reuse"; userId: string; familyId: string };

export interface AuthServiceDeps {
  readonly db: Database;
  readonly hasher: PasswordHasher;
  readonly accessTokens: AccessTokens;
  readonly csrf: CsrfTokens;
  readonly config: AuthServiceConfig;
  readonly onSecurityEvent?: (event: SecurityEvent) => void;
  /** Called for failures that do not stop the request, for example a failed hash upgrade. */
  readonly onError?: (error: unknown) => void;
}

export interface AuthResult {
  readonly user: PublicUser;
  readonly accessToken: string;
  /** Seconds until the access token expires. */
  readonly expiresIn: number;
  readonly refreshToken: string;
  readonly refreshExpiresAt: Date;
  readonly csrfToken: string;
}

export interface RegisterInput {
  readonly email: string;
  readonly password: string;
  readonly displayName?: string | null | undefined;
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

export interface AuthService {
  /** Creates the account and signs in. Throws ValidationError (400) or ConflictError (409). */
  register(input: RegisterInput): Promise<AuthResult>;
  /** Throws UnauthorizedError with one fixed message for any failure. */
  login(input: LoginInput): Promise<AuthResult>;
  /** Swaps the refresh token for the next one. Throws UnauthorizedError for any failure. */
  refresh(refreshToken: string): Promise<AuthResult>;
  /** Ends the login. Never fails because of the token: a missing or bad one is a no-op. */
  logout(refreshToken: string | undefined): Promise<void>;
  /** The user and login family behind a live refresh token, for the CSRF check. */
  identifyRefreshToken(
    refreshToken: string | undefined,
  ): Promise<{ userId: string; familyId: string } | undefined>;
  verifyCsrf(familyId: string, candidate: string | undefined): boolean;
  /** Checks an access token without touching the database. */
  authenticate(accessToken: string): Promise<{ userId: string } | undefined>;
  /** The current user, or UnauthorizedError if the account is gone. */
  me(userId: string): Promise<PublicUser>;
}

export function createAuthService(deps: AuthServiceDeps): AuthService {
  const { db, hasher, accessTokens, csrf, config } = deps;

  async function startLogin(user: PublicUser): Promise<AuthResult> {
    const familyId = randomUUID();
    const refreshToken = generateRefreshToken();
    const { expiresAt } = await createSession(db, {
      userId: user.id,
      familyId,
      tokenHash: hashRefreshToken(refreshToken),
      ttlDays: config.refreshTtlDays,
    });
    const { token, expiresIn } = await accessTokens.sign(user.id);
    return {
      user,
      accessToken: token,
      expiresIn,
      refreshToken,
      refreshExpiresAt: expiresAt,
      csrfToken: csrf.derive(familyId),
    };
  }

  return {
    async register(input) {
      const email = normalizeEmail(input.email);
      const issues: ProblemIssue[] = [];
      if (!checkEmail(email)) {
        issues.push({ source: "body", pointer: "/email", message: "Enter a valid email address." });
      }
      const passwordIssue = checkPasswordPolicy(input.password);
      if (passwordIssue !== undefined) {
        issues.push({
          source: "body",
          pointer: "/password",
          message: PASSWORD_ISSUE_MESSAGES[passwordIssue],
        });
      }
      const rawName = input.displayName ?? null;
      if (rawName !== null) {
        const nameIssue = checkDisplayName(rawName);
        if (nameIssue !== undefined) {
          issues.push({
            source: "body",
            pointer: "/displayName",
            message: DISPLAY_NAME_MESSAGES[nameIssue],
          });
        }
      }
      if (issues.length > 0) throw new ValidationError(issues);

      const passwordHash = await hasher.hash(input.password);
      try {
        const user = await createUser(db, {
          email,
          passwordHash,
          displayName: rawName === null ? null : normalizeDisplayName(rawName),
        });
        return await startLogin(toPublicUser(user));
      } catch (error) {
        if (error instanceof EmailTakenError) {
          throw new ConflictError("That email is already registered.", { cause: error });
        }
        throw error;
      }
    },

    async login(input) {
      const invalid = () => new UnauthorizedError(INVALID_CREDENTIALS);
      // Every stored password passed the policy, so one that fails it cannot be right. This also
      // keeps huge or malformed values away from the hashing code.
      if (
        input.password.length > MAX_LOGIN_PASSWORD_UNITS ||
        checkPasswordPolicy(input.password) !== undefined
      ) {
        throw invalid();
      }

      const email = normalizeEmail(input.email);
      const user = checkEmail(email) ? await findUserByEmail(db, email) : undefined;
      if (user === undefined) {
        // Same amount of work as a real check, so the response time does not reveal the email.
        await hasher.verifyAgainstDummy(input.password);
        throw invalid();
      }

      if (!(await hasher.verify(user.passwordHash, input.password))) throw invalid();

      if (hasher.needsRehash(user.passwordHash)) {
        try {
          await updatePasswordHash(db, user.id, await hasher.hash(input.password));
        } catch (error) {
          deps.onError?.(error);
        }
      }
      return startLogin(toPublicUser(user));
    },

    async refresh(refreshToken) {
      const expired = () => new UnauthorizedError(SESSION_EXPIRED);
      if (!isWellFormedRefreshToken(refreshToken)) throw expired();

      const nextToken = generateRefreshToken();
      const result = await rotateSession(db, {
        tokenHash: hashRefreshToken(refreshToken),
        newTokenHash: hashRefreshToken(nextToken),
        ttlDays: config.refreshTtlDays,
        absoluteDays: config.refreshAbsoluteDays,
        graceSeconds: config.refreshGraceSeconds,
      });

      if (result.status === "reuse") {
        deps.onSecurityEvent?.({
          type: "refresh-reuse",
          userId: result.userId,
          familyId: result.familyId,
        });
      }
      if (result.status !== "rotated") throw expired();

      const user = await findUserById(db, result.userId);
      if (user === undefined) throw expired();
      const { token, expiresIn } = await accessTokens.sign(user.id);
      return {
        user: toPublicUser(user),
        accessToken: token,
        expiresIn,
        refreshToken: nextToken,
        refreshExpiresAt: result.expiresAt,
        csrfToken: csrf.derive(result.familyId),
      };
    },

    async logout(refreshToken) {
      if (refreshToken === undefined || !isWellFormedRefreshToken(refreshToken)) return;
      await revokeFamilyByToken(db, hashRefreshToken(refreshToken));
    },

    async identifyRefreshToken(refreshToken) {
      if (refreshToken === undefined || !isWellFormedRefreshToken(refreshToken)) return undefined;
      return findLiveSession(db, hashRefreshToken(refreshToken));
    },

    verifyCsrf: (familyId, candidate) => csrf.verify(familyId, candidate),

    authenticate: (accessToken) => accessTokens.verify(accessToken),

    async me(userId) {
      const user = await findUserById(db, userId);
      if (user === undefined) throw new UnauthorizedError();
      return toPublicUser(user);
    },
  };
}
