import argon2 from "argon2";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseHandle } from "../../db/client.ts";
import { refreshSessions } from "../../db/schema/refresh-sessions.ts";
import { users } from "../../db/schema/users.ts";
import { connectTestDatabase, resetTables } from "../../db/test-support/test-database.ts";
import {
  ConflictError,
  ServiceBusyError,
  UnauthorizedError,
  ValidationError,
} from "../../errors/app-error.ts";
import { createPasswordHasher, type PasswordHasher } from "../password.ts";
import {
  type AuthService,
  type AuthServiceDeps,
  createAuthService,
  type SecurityEvent,
} from "../service.ts";
import {
  createAccessTokens,
  createCsrfTokens,
  hashRefreshToken,
  isWellFormedRefreshToken,
} from "../tokens.ts";

const SECRET = "k3Y7mQ2vX9bR5tN8wZ1cL6hD4fJ0sA3gUe7Pq2OxVn8Rb5Tm";
const CHEAP = { type: argon2.argon2id, memoryCost: 8, timeCost: 1, parallelism: 1 } as const;
const STRONGER = { type: argon2.argon2id, memoryCost: 64, timeCost: 2, parallelism: 1 } as const;
const PASSWORD = "correct horse battery staple";
const DAY_MS = 24 * 60 * 60 * 1000;

describe("auth service", () => {
  let handle: DatabaseHandle;
  let events: SecurityEvent[];
  let errors: unknown[];

  beforeAll(() => {
    handle = connectTestDatabase();
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await resetTables(handle);
    events = [];
    errors = [];
  });

  const accessTokens = createAccessTokens({ secret: SECRET, ttlSeconds: 900 });
  const csrf = createCsrfTokens(SECRET);

  function build(overrides: Partial<AuthServiceDeps> = {}): AuthService {
    return createAuthService({
      db: handle.db,
      hasher: createPasswordHasher({ params: CHEAP }),
      accessTokens,
      csrf,
      config: { refreshTtlDays: 30, refreshAbsoluteDays: 90, refreshGraceSeconds: 10 },
      onSecurityEvent: (event) => events.push(event),
      onError: (error) => errors.push(error),
      ...overrides,
    });
  }

  /** A hasher that counts what the service asks of it. */
  function spyOn(hasher: PasswordHasher) {
    return {
      hasher: {
        hash: vi.fn(hasher.hash),
        verify: vi.fn(hasher.verify),
        needsRehash: vi.fn(hasher.needsRehash),
        verifyAgainstDummy: vi.fn(hasher.verifyAgainstDummy),
        warmUp: vi.fn(hasher.warmUp),
      } satisfies PasswordHasher,
    };
  }

  const signUp = (service: AuthService, email = "mara@example.com", password = PASSWORD) =>
    service.register({ email, password, displayName: "Mara" });

  const sessionRows = () => handle.db.select().from(refreshSessions);
  const userRows = () => handle.db.select().from(users);

  describe("register", () => {
    it("creates the account and signs the user in", async () => {
      const service = build();
      const result = await signUp(service);

      expect(result.user).toEqual({
        id: expect.any(String),
        email: "mara@example.com",
        displayName: "Mara",
      });
      expect(result.expiresIn).toBe(900);
      await expect(accessTokens.verify(result.accessToken)).resolves.toEqual({
        userId: result.user.id,
      });
      expect(isWellFormedRefreshToken(result.refreshToken)).toBe(true);
    });

    it("stores an argon2id hash, never the password", async () => {
      await signUp(build());
      const [user] = await userRows();
      expect(user?.passwordHash.startsWith("$argon2id$")).toBe(true);
      expect(user?.passwordHash).not.toContain(PASSWORD);
    });

    it("stores only the hash of the refresh token and ties the CSRF code to the login", async () => {
      const result = await signUp(build());
      const [session] = await sessionRows();
      expect(session?.tokenHash).toBe(hashRefreshToken(result.refreshToken));
      expect(session?.userId).toBe(result.user.id);
      expect(JSON.stringify(session)).not.toContain(result.refreshToken);
      expect(csrf.verify(session?.familyId ?? "", result.csrfToken)).toBe(true);
    });

    it("sets the refresh expiry about 30 days ahead", async () => {
      const result = await signUp(build());
      expect(Math.abs(result.refreshExpiresAt.getTime() - (Date.now() + 30 * DAY_MS))).toBeLessThan(
        60_000,
      );
    });

    it("trims and lowercases the email", async () => {
      const result = await signUp(build(), "  Mara.Writer@Example.COM \n");
      expect(result.user.email).toBe("mara.writer@example.com");
    });

    it("accepts a missing display name or null", async () => {
      const service = build();
      const a = await service.register({ email: "a@example.com", password: PASSWORD });
      const b = await service.register({
        email: "b@example.com",
        password: PASSWORD,
        displayName: null,
      });
      expect(a.user.displayName).toBeNull();
      expect(b.user.displayName).toBeNull();
    });

    it("trims the display name", async () => {
      const result = await build().register({
        email: "a@example.com",
        password: PASSWORD,
        displayName: "  Mara  ",
      });
      expect(result.user.displayName).toBe("Mara");
    });

    it.each(["mara@example.com", "MARA@EXAMPLE.COM", "  Mara@Example.com  "])(
      "answers 409 when %s is already registered",
      async (again) => {
        const service = build();
        await signUp(service, "mara@example.com");
        await expect(signUp(service, again)).rejects.toBeInstanceOf(ConflictError);
        expect(await userRows()).toHaveLength(1);
        expect(await sessionRows()).toHaveLength(1);
      },
    );

    it("lets exactly one of several simultaneous sign-ups win and never fails with anything else", async () => {
      const service = build();
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () => signUp(service, "race@example.com")),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results) {
        if (r.status === "rejected") expect(r.reason).toBeInstanceOf(ConflictError);
      }
      expect(await userRows()).toHaveLength(1);
    });

    it("folds the password to NFKC so it works however it is typed", async () => {
      const service = build();
      await service.register({ email: "a@example.com", password: "ｐａｓｓｗｏｒｄ１２３４５６" });
      await expect(
        service.login({ email: "a@example.com", password: "password123456" }),
      ).resolves.toBeDefined();
    });

    describe("rejects bad input with every problem listed and writes nothing", () => {
      it("lists each field separately", async () => {
        const error = await build()
          .register({ email: "not-an-email", password: "short", displayName: "a\tb" })
          .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ValidationError);
        const pointers = (error as ValidationError).extensions.errors as {
          pointer: string;
          source: string;
        }[];
        expect(pointers.map((p) => p.pointer).sort()).toEqual([
          "/displayName",
          "/email",
          "/password",
        ]);
        expect(pointers.every((p) => p.source === "body")).toBe(true);
        expect(await userRows()).toHaveLength(0);
        expect(await sessionRows()).toHaveLength(0);
      });

      it.each([
        ["an email without a domain", { email: "mara@" }, "/email"],
        ["a non-ASCII email", { email: "mára@example.com" }, "/email"],
        [
          "a 255-character email",
          { email: `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.com` },
          "/email",
        ],
        ["an 11-character password", { password: "a".repeat(11) }, "/password"],
        ["a 129-character password", { password: "a".repeat(129) }, "/password"],
        ["a password with a NUL", { password: "valid-password-\u0000-x" }, "/password"],
        ["a password of spaces", { password: " ".repeat(20) }, "/password"],
        ["an empty display name", { displayName: "" }, "/displayName"],
        ["an 81-character display name", { displayName: "a".repeat(81) }, "/displayName"],
        ["a display name with a newline", { displayName: "Ma\nra" }, "/displayName"],
      ])("%s", async (_label, change, pointer) => {
        const input = { email: "ok@example.com", password: PASSWORD, displayName: "Ok", ...change };
        const error = await build()
          .register(input)
          .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ValidationError);
        const issues = (error as ValidationError).extensions.errors as { pointer: string }[];
        expect(issues.map((i) => i.pointer)).toEqual([pointer]);
        expect(await userRows()).toHaveLength(0);
      });

      it("never repeats the password or email in the error", async () => {
        const secret = "SECRET-pw";
        const error = await build()
          .register({ email: "leak-me", password: secret })
          .catch((e: unknown) => e);
        const text =
          JSON.stringify((error as ValidationError).extensions) + (error as Error).message;
        expect(text).not.toContain(secret);
        expect(text).not.toContain("leak-me");
      });
    });

    it("passes a busy-server error on and creates nothing", async () => {
      const busy = createPasswordHasher({ params: CHEAP });
      const service = build({
        hasher: { ...busy, hash: () => Promise.reject(new ServiceBusyError()) },
      });
      await expect(signUp(service)).rejects.toBeInstanceOf(ServiceBusyError);
      expect(await userRows()).toHaveLength(0);
    });
  });

  describe("login", () => {
    it("signs in with the right password", async () => {
      const service = build();
      const registered = await signUp(service);
      const result = await service.login({ email: "mara@example.com", password: PASSWORD });

      expect(result.user.id).toBe(registered.user.id);
      await expect(accessTokens.verify(result.accessToken)).resolves.toEqual({
        userId: registered.user.id,
      });
      expect(isWellFormedRefreshToken(result.refreshToken)).toBe(true);
    });

    it("ignores case and padding in the email", async () => {
      const service = build();
      await signUp(service);
      await expect(
        service.login({ email: "  MARA@Example.com ", password: PASSWORD }),
      ).resolves.toBeDefined();
    });

    it("gives every login its own family and keeps the earlier ones working", async () => {
      const service = build();
      const first = await signUp(service);
      const second = await service.login({ email: "mara@example.com", password: PASSWORD });
      expect(second.refreshToken).not.toBe(first.refreshToken);
      expect(second.csrfToken).not.toBe(first.csrfToken);
      await expect(service.refresh(first.refreshToken)).resolves.toBeDefined();
      await expect(service.refresh(second.refreshToken)).resolves.toBeDefined();
    });

    describe("a failed login", () => {
      it("gives the same error for a wrong password and an unknown email", async () => {
        const service = build();
        await signUp(service);
        const wrong = await service
          .login({ email: "mara@example.com", password: "wrong password 123" })
          .catch((e: unknown) => e);
        const unknown = await service
          .login({ email: "nobody@example.com", password: PASSWORD })
          .catch((e: unknown) => e);

        expect(wrong).toBeInstanceOf(UnauthorizedError);
        expect(unknown).toBeInstanceOf(UnauthorizedError);
        expect((wrong as UnauthorizedError).detail).toBe((unknown as UnauthorizedError).detail);
        expect((wrong as UnauthorizedError).status).toBe((unknown as UnauthorizedError).status);
        expect((wrong as UnauthorizedError).detail).toBe("Invalid email or password.");
        expect(Object.keys((wrong as UnauthorizedError).extensions)).toEqual(
          Object.keys((unknown as UnauthorizedError).extensions),
        );
      });

      it("does the same amount of hashing work for an unknown email as for a real one", async () => {
        const { hasher } = spyOn(createPasswordHasher({ params: CHEAP }));
        const service = build({ hasher });
        await signUp(service);
        hasher.verify.mockClear();
        hasher.verifyAgainstDummy.mockClear();

        await service
          .login({ email: "mara@example.com", password: "wrong password 123" })
          .catch(() => {});
        expect(hasher.verify).toHaveBeenCalledTimes(1);
        expect(hasher.verifyAgainstDummy).not.toHaveBeenCalled();

        hasher.verify.mockClear();
        await service
          .login({ email: "nobody@example.com", password: "wrong password 123" })
          .catch(() => {});
        expect(hasher.verifyAgainstDummy).toHaveBeenCalledTimes(1);
        expect(hasher.verify).not.toHaveBeenCalled();
      });

      it("also spends the time for an email that is not even valid", async () => {
        const { hasher } = spyOn(createPasswordHasher({ params: CHEAP }));
        const service = build({ hasher });
        await service.login({ email: "not an email", password: PASSWORD }).catch(() => {});
        expect(hasher.verifyAgainstDummy).toHaveBeenCalledTimes(1);
      });

      it.each([
        ["too long", "a".repeat(129)],
        ["a NUL", "valid-password-\u0000-x"],
        ["a lone surrogate", "valid-password-\uD800-x"],
        ["a megabyte", "a".repeat(1_000_000)],
      ])("refuses a password that is %s without hashing it", async (_label, password) => {
        const { hasher } = spyOn(createPasswordHasher({ params: CHEAP }));
        const service = build({ hasher });
        await signUp(service);
        hasher.hash.mockClear();
        hasher.verify.mockClear();

        await expect(service.login({ email: "mara@example.com", password })).rejects.toBeInstanceOf(
          UnauthorizedError,
        );
        expect(hasher.verify).not.toHaveBeenCalled();
        expect(hasher.hash).not.toHaveBeenCalled();
      });

      it("creates no session", async () => {
        const service = build();
        await signUp(service);
        await service
          .login({ email: "mara@example.com", password: "wrong password 123" })
          .catch(() => {});
        expect(await sessionRows()).toHaveLength(1);
      });
    });

    describe("upgrading an old hash", () => {
      it("replaces a weaker hash after a successful login", async () => {
        const weak = createPasswordHasher({ params: CHEAP });
        await signUp(build({ hasher: weak }));
        const [before] = await userRows();

        const strong = createPasswordHasher({ params: STRONGER });
        const service = build({ hasher: strong });
        await service.login({ email: "mara@example.com", password: PASSWORD });

        const [after] = await userRows();
        expect(after?.passwordHash).not.toBe(before?.passwordHash);
        expect(after?.passwordHash).toContain("m=64");
        await expect(
          service.login({ email: "mara@example.com", password: PASSWORD }),
        ).resolves.toBeDefined();
      });

      it("leaves a current hash alone", async () => {
        const service = build();
        await signUp(service);
        const [before] = await userRows();
        await service.login({ email: "mara@example.com", password: PASSWORD });
        expect((await userRows())[0]?.passwordHash).toBe(before?.passwordHash);
      });

      it("does not upgrade after a wrong password", async () => {
        await signUp(build());
        const [before] = await userRows();
        const service = build({ hasher: createPasswordHasher({ params: STRONGER }) });
        await service
          .login({ email: "mara@example.com", password: "wrong password 123" })
          .catch(() => {});
        expect((await userRows())[0]?.passwordHash).toBe(before?.passwordHash);
      });

      it("still signs the user in when the upgrade fails, and reports the failure", async () => {
        await signUp(build());
        const failing = createPasswordHasher({ params: STRONGER });
        const service = build({
          hasher: { ...failing, hash: () => Promise.reject(new Error("hash broke")) },
        });
        await expect(
          service.login({ email: "mara@example.com", password: PASSWORD }),
        ).resolves.toBeDefined();
        expect(errors).toHaveLength(1);
        expect((errors[0] as Error).message).toBe("hash broke");
      });
    });

    it("handles many simultaneous logins", async () => {
      const service = build();
      await signUp(service);
      const results = await Promise.all(
        Array.from({ length: 12 }, () =>
          service.login({ email: "mara@example.com", password: PASSWORD }),
        ),
      );
      expect(new Set(results.map((r) => r.refreshToken)).size).toBe(12);
    });
  });

  describe("refresh", () => {
    it("hands out a new token, kills the old one and keeps the same CSRF code", async () => {
      const service = build();
      const first = await signUp(service);
      const next = await service.refresh(first.refreshToken);

      expect(next.refreshToken).not.toBe(first.refreshToken);
      expect(next.csrfToken).toBe(first.csrfToken);
      expect(next.user).toEqual(first.user);
      await expect(accessTokens.verify(next.accessToken)).resolves.toEqual({
        userId: first.user.id,
      });
      await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(UnauthorizedError);
      await expect(service.refresh(next.refreshToken)).resolves.toBeDefined();
    });

    it("can be repeated many times", async () => {
      const service = build();
      let current = (await signUp(service)).refreshToken;
      for (let i = 0; i < 6; i++) current = (await service.refresh(current)).refreshToken;
      expect(await sessionRows()).toHaveLength(7);
    });

    it.each([
      ["an empty token", ""],
      ["a token that is too short", "abc"],
      ["a token that is too long", "a".repeat(44)],
      ["a token with a bad character", `${"a".repeat(42)}+`],
      ["a well-formed token nobody issued", "A".repeat(43)],
      ["a megabyte of text", "a".repeat(1_000_000)],
    ])("refuses %s", async (_label, token) => {
      await expect(build().refresh(token)).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it("refuses an expired token", async () => {
      const service = build();
      const first = await signUp(service);
      await handle.db.execute(
        sql`update refresh_sessions
            set created_at = now() - interval '2 days', expires_at = now() - interval '1 day'`,
      );
      await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(UnauthorizedError);
      expect(events).toEqual([]);
    });

    it("refuses a token for a deleted user", async () => {
      const service = build();
      const first = await signUp(service);
      await handle.db.delete(users).where(eq(users.id, first.user.id));
      await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it("answers with the same error whatever the reason", async () => {
      const service = build();
      const first = await signUp(service);
      await service.refresh(first.refreshToken);
      const reasons = await Promise.all([
        service.refresh("A".repeat(43)).catch((e: unknown) => e),
        service.refresh("not valid").catch((e: unknown) => e),
        service.refresh(first.refreshToken).catch((e: unknown) => e),
      ]);
      const details = new Set(reasons.map((e) => (e as UnauthorizedError).detail));
      expect(details.size).toBe(1);
    });

    describe("a token that is used a second time", () => {
      it("is refused without a security event inside the grace window", async () => {
        const service = build();
        const first = await signUp(service);
        const next = await service.refresh(first.refreshToken);
        await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(UnauthorizedError);
        expect(events).toEqual([]);
        await expect(service.refresh(next.refreshToken)).resolves.toBeDefined();
      });

      it("revokes the whole login and raises a security event after the grace window", async () => {
        const service = build();
        const first = await signUp(service);
        const next = await service.refresh(first.refreshToken);
        await handle.db.execute(
          sql`update refresh_sessions set revoked_at = now() - interval '5 minutes'
              where token_hash = ${hashRefreshToken(first.refreshToken)}`,
        );

        await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(UnauthorizedError);
        expect(events).toEqual([
          { type: "refresh-reuse", userId: first.user.id, familyId: expect.any(String) },
        ]);
        await expect(service.refresh(next.refreshToken)).rejects.toBeInstanceOf(UnauthorizedError);
      });

      it("does not touch the user's other logins", async () => {
        const service = build();
        const phone = await signUp(service);
        const laptop = await service.login({ email: "mara@example.com", password: PASSWORD });
        const next = await service.refresh(phone.refreshToken);
        await handle.db.execute(
          sql`update refresh_sessions set revoked_at = now() - interval '5 minutes'
              where token_hash = ${hashRefreshToken(phone.refreshToken)}`,
        );
        await service.refresh(phone.refreshToken).catch(() => {});
        await expect(service.refresh(next.refreshToken)).rejects.toBeInstanceOf(UnauthorizedError);
        await expect(service.refresh(laptop.refreshToken)).resolves.toBeDefined();
      });
    });

    it("lets exactly one of several simultaneous refreshes win and does not throw anyone out", async () => {
      const service = build();
      const first = await signUp(service);
      const attempts = await Promise.allSettled(
        Array.from({ length: 6 }, () => service.refresh(first.refreshToken)),
      );
      const winners = attempts.filter(
        (a): a is PromiseFulfilledResult<Awaited<ReturnType<AuthService["refresh"]>>> =>
          a.status === "fulfilled",
      );
      expect(winners).toHaveLength(1);
      expect(events).toEqual([]);
      await expect(service.refresh(winners[0]?.value.refreshToken ?? "")).resolves.toBeDefined();
    });
  });

  describe("logout", () => {
    it("ends the login", async () => {
      const service = build();
      const first = await signUp(service);
      await service.logout(first.refreshToken);
      await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it("ends the login even after the token has been renewed", async () => {
      const service = build();
      const first = await signUp(service);
      const next = await service.refresh(first.refreshToken);
      await service.logout(next.refreshToken);
      await expect(service.refresh(next.refreshToken)).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it("can be done twice", async () => {
      const service = build();
      const first = await signUp(service);
      await service.logout(first.refreshToken);
      await expect(service.logout(first.refreshToken)).resolves.toBeUndefined();
    });

    it.each([
      ["no token", undefined],
      ["an empty token", ""],
      ["a malformed token", "not valid"],
      ["a well-formed unknown token", "A".repeat(43)],
    ])("does nothing and does not fail with %s", async (_label, token) => {
      const service = build();
      await signUp(service);
      await expect(service.logout(token)).resolves.toBeUndefined();
      expect((await sessionRows()).every((r) => r.revokedAt === null)).toBe(true);
    });

    it("leaves the user's other logins alone", async () => {
      const service = build();
      const phone = await signUp(service);
      const laptop = await service.login({ email: "mara@example.com", password: PASSWORD });
      await service.logout(phone.refreshToken);
      await expect(service.refresh(laptop.refreshToken)).resolves.toBeDefined();
    });
  });

  describe("identifyRefreshToken and verifyCsrf", () => {
    it("identifies a live token", async () => {
      const service = build();
      const first = await signUp(service);
      const found = await service.identifyRefreshToken(first.refreshToken);
      expect(found?.userId).toBe(first.user.id);
      expect(service.verifyCsrf(found?.familyId ?? "", first.csrfToken)).toBe(true);
    });

    it.each([
      ["undefined", undefined],
      ["an empty string", ""],
      ["a malformed token", "nope"],
      ["an unknown token", "A".repeat(43)],
    ])("finds nothing for %s", async (_label, token) => {
      await expect(build().identifyRefreshToken(token)).resolves.toBeUndefined();
    });

    // A token that is no longer live must still be identified. The CSRF check needs its family
    // before anything is rotated, and a replayed old token has to reach the theft detection.
    it("still identifies a token that has been replaced or logged out", async () => {
      const service = build();
      const first = await signUp(service);
      const live = await service.identifyRefreshToken(first.refreshToken);
      await service.refresh(first.refreshToken);
      await expect(service.identifyRefreshToken(first.refreshToken)).resolves.toEqual(live);
      await service.logout(first.refreshToken);
      await expect(service.identifyRefreshToken(first.refreshToken)).resolves.toEqual(live);
    });

    it("still identifies an expired token", async () => {
      const service = build();
      const first = await signUp(service);
      const live = await service.identifyRefreshToken(first.refreshToken);
      await handle.db.execute(
        sql`update refresh_sessions
            set created_at = now() - interval '2 days', expires_at = now() - interval '1 day'`,
      );
      await expect(service.identifyRefreshToken(first.refreshToken)).resolves.toEqual(live);
    });

    it("lets a replayed old token reach the theft detection after its family was identified", async () => {
      const service = build();
      const first = await signUp(service);
      const family = await service.identifyRefreshToken(first.refreshToken);
      await service.refresh(first.refreshToken);
      await handle.db.execute(
        sql`update refresh_sessions set revoked_at = now() - interval '5 minutes' where revoked_at is not null`,
      );
      expect(service.verifyCsrf(family?.familyId ?? "", first.csrfToken)).toBe(true);
      await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(UnauthorizedError);
      expect(events).toHaveLength(1);
    });

    it("rejects a CSRF code from another login", async () => {
      const service = build();
      const phone = await signUp(service);
      const laptop = await service.login({ email: "mara@example.com", password: PASSWORD });
      const found = await service.identifyRefreshToken(phone.refreshToken);
      expect(service.verifyCsrf(found?.familyId ?? "", laptop.csrfToken)).toBe(false);
      expect(service.verifyCsrf(found?.familyId ?? "", undefined)).toBe(false);
    });
  });

  describe("authenticate and me", () => {
    it("accepts a valid access token", async () => {
      const service = build();
      const first = await signUp(service);
      await expect(service.authenticate(first.accessToken)).resolves.toEqual({
        userId: first.user.id,
      });
    });

    it("refuses anything else without saying why", async () => {
      const service = build();
      await expect(service.authenticate("garbage")).resolves.toBeUndefined();
      await expect(service.authenticate("")).resolves.toBeUndefined();
    });

    it("returns the public user and never the hash", async () => {
      const service = build();
      const first = await signUp(service);
      const me = await service.me(first.user.id);
      expect(me).toEqual(first.user);
      expect(JSON.stringify(me)).not.toContain("argon2");
    });

    it("refuses a user that no longer exists", async () => {
      const service = build();
      const first = await signUp(service);
      await handle.db.delete(users).where(eq(users.id, first.user.id));
      await expect(service.me(first.user.id)).rejects.toBeInstanceOf(UnauthorizedError);
    });
  });

  describe("secrets in errors", () => {
    it("never put the password into any error message", async () => {
      const secret = "UNIQUE-secret-password-ZZ9";
      const service = build();
      await service.register({ email: "a@example.com", password: secret });
      const failures = await Promise.all([
        service.register({ email: "a@example.com", password: secret }).catch((e: unknown) => e),
        service.login({ email: "a@example.com", password: `${secret}x` }).catch((e: unknown) => e),
        service.login({ email: "zzz@example.com", password: secret }).catch((e: unknown) => e),
      ]);
      for (const failure of failures) {
        expect(JSON.stringify(failure, Object.getOwnPropertyNames(failure))).not.toContain(secret);
      }
    });
  });
});
