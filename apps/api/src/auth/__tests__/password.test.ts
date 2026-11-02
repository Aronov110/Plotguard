import argon2 from "argon2";
import { describe, expect, it } from "vitest";
import {
  checkPasswordPolicy,
  createPasswordHasher,
  DEFAULT_ARGON2_PARAMS,
  normalizePassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type TaskGate,
} from "../password.ts";

/** Cheap settings so the suite stays fast. One test checks the real defaults. */
const CHEAP = { type: argon2.argon2id, memoryCost: 8, timeCost: 1, parallelism: 1 } as const;

describe("checkPasswordPolicy", () => {
  it("exposes the documented limits", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
  });

  it.each([
    [11, "too-short"],
    [12, undefined],
    [13, undefined],
    [128, undefined],
    [129, "too-long"],
    [1000, "too-long"],
    [0, "too-short"],
  ] as const)("a %i character password gives %s", (length, expected) => {
    expect(checkPasswordPolicy("a".repeat(length))).toBe(expected);
  });

  it("accepts a passphrase with spaces inside", () => {
    expect(checkPasswordPolicy("correct horse battery staple")).toBeUndefined();
  });

  it("accepts every kind of printable character", () => {
    expect(checkPasswordPolicy("Päss wörd! #€ ñ 日本語パスワード")).toBeUndefined();
  });

  it("counts characters, not UTF-16 units: 12 emoji pass and 11 do not", () => {
    expect(checkPasswordPolicy("😀".repeat(12))).toBeUndefined();
    expect(checkPasswordPolicy("😀".repeat(11))).toBe("too-short");
  });

  it("accepts 128 emoji (512 bytes) and rejects 129", () => {
    expect(checkPasswordPolicy("😀".repeat(128))).toBeUndefined();
    expect(checkPasswordPolicy("😀".repeat(129))).toBe("too-long");
  });

  it("counts the length after normalisation, so a ligature cannot sneak in a short password", () => {
    // U+FB01 normalises to "fi": 6 ligatures are 12 characters, 5 are 10.
    expect(checkPasswordPolicy("ﬁ".repeat(6))).toBeUndefined();
    expect(checkPasswordPolicy("ﬁ".repeat(5))).toBe("too-short");
  });

  it("rejects a password that expands past the maximum when normalised", () => {
    // U+FDFA expands to 18 characters, so 8 of them are 144.
    expect(checkPasswordPolicy("ﷺ".repeat(8))).toBe("too-long");
  });

  it.each([
    ["a NUL byte", "valid-password-\u0000-x"],
    ["a tab", "valid-password-\t-x"],
    ["a newline", "valid-password-\n-x"],
    ["a carriage return", "valid-password-\r-x"],
    ["DEL", "valid-password-\u007F-x"],
    ["a C1 control character", "valid-password-\u0085-x"],
    ["an escape character", "valid-password-\u001B-x"],
  ])("rejects %s", (_label, password) => {
    expect(checkPasswordPolicy(password)).toBe("control-character");
  });

  it("rejects a lone surrogate, which would silently turn into U+FFFD", () => {
    expect(checkPasswordPolicy("valid-password-\uD800-x")).toBe("malformed-unicode");
    expect(checkPasswordPolicy(`${"a".repeat(12)}\uDC00`)).toBe("malformed-unicode");
  });

  it.each([
    ["spaces", " ".repeat(20)],
    ["a no-break space", " ".repeat(20)],
    ["an ideographic space", "　".repeat(20)],
    ["mixed whitespace", "  　 ".repeat(5)],
  ])("rejects %s only", (_label, password) => {
    expect(checkPasswordPolicy(password)).toBe("only-whitespace");
  });

  it("allows leading and trailing spaces around real characters", () => {
    expect(checkPasswordPolicy("   padded password   ")).toBeUndefined();
  });
});

describe("normalizePassword", () => {
  it("folds composed and decomposed forms together", () => {
    expect(normalizePassword("é")).toBe(normalizePassword("é"));
  });

  it("folds compatibility characters such as full-width letters", () => {
    expect(normalizePassword("ｐａｓｓ１２３")).toBe("pass123");
  });

  it("leaves plain ASCII untouched", () => {
    expect(normalizePassword("Plain ASCII 123!")).toBe("Plain ASCII 123!");
  });
});

describe("createPasswordHasher", () => {
  const hasher = createPasswordHasher({ params: CHEAP });

  it("produces an argon2id hash and verifies the right password", async () => {
    const hash = await hasher.hash("correct horse battery staple");
    expect(hash.startsWith("$argon2id$v=19$")).toBe(true);
    await expect(hasher.verify(hash, "correct horse battery staple")).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hasher.hash("correct horse battery staple");
    await expect(hasher.verify(hash, "correct horse battery stapl")).resolves.toBe(false);
    await expect(hasher.verify(hash, "")).resolves.toBe(false);
  });

  it("is case sensitive", async () => {
    const hash = await hasher.hash("Correct Horse Battery");
    await expect(hasher.verify(hash, "correct horse battery")).resolves.toBe(false);
  });

  it("salts every hash, so equal passwords give different hashes", async () => {
    const [a, b] = await Promise.all([
      hasher.hash("same password 123"),
      hasher.hash("same password 123"),
    ]);
    expect(a).not.toBe(b);
  });

  it("verifies a composed password against its decomposed form", async () => {
    const hash = await hasher.hash("café au lait 123");
    await expect(hasher.verify(hash, "café au lait 123")).resolves.toBe(true);
  });

  it("verifies a full-width password against its ASCII form, which is the intended folding", async () => {
    const hash = await hasher.hash("ｐａｓｓｗｏｒｄ１２３４５６");
    await expect(hasher.verify(hash, "password123456")).resolves.toBe(true);
  });

  it("handles a 128-emoji password", async () => {
    const password = "😀".repeat(128);
    const hash = await hasher.hash(password);
    await expect(hasher.verify(hash, password)).resolves.toBe(true);
    await expect(hasher.verify(hash, "😀".repeat(127))).resolves.toBe(false);
  });

  it.each([
    ["an empty string", ""],
    ["plain text", "not-a-hash"],
    ["a truncated argon2 hash", "$argon2id$v=19$m=8,t=1,p=1$"],
    ["garbage after the prefix", "$argon2id$garbage"],
    ["a bcrypt hash", "$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234"],
    ["a very long string", "$argon2id$".concat("x".repeat(100_000))],
    ["a string with a NUL", "$argon2id$v=19$m=8,t=1,p=1$\u0000$\u0000"],
  ])("returns false for %s instead of throwing", async (_label, hash) => {
    await expect(hasher.verify(hash, "whatever password")).resolves.toBe(false);
  });

  describe("needsRehash", () => {
    it("is false for a hash made with the same settings", async () => {
      expect(hasher.needsRehash(await hasher.hash("some password 123"))).toBe(false);
    });

    it("is true when the stored hash is weaker than the current settings", async () => {
      const weak = createPasswordHasher({ params: CHEAP });
      const strong = createPasswordHasher({ params: { ...CHEAP, memoryCost: 64, timeCost: 2 } });
      expect(strong.needsRehash(await weak.hash("some password 123"))).toBe(true);
    });

    it("is true for an argon2i hash even when the costs match", async () => {
      const argon2iHash = await argon2.hash("some password 123", {
        ...CHEAP,
        type: argon2.argon2i,
      });
      expect(hasher.needsRehash(argon2iHash)).toBe(true);
    });

    it("is false for a malformed hash, which cannot be upgraded anyway", () => {
      expect(hasher.needsRehash("not-a-hash")).toBe(false);
      expect(hasher.needsRehash("")).toBe(false);
    });
  });

  describe("the real default settings", () => {
    it("use the OWASP minimum for argon2id: 19 MiB, 2 passes, 1 lane", async () => {
      expect(DEFAULT_ARGON2_PARAMS).toMatchObject({
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
      const hash = await createPasswordHasher().hash("a default settings password");
      expect(hash).toContain("$argon2id$v=19$");
      expect(hash).toMatch(/m=19456/);
      expect(hash).toMatch(/t=2/);
      expect(hash).toMatch(/p=1/);
    });
  });

  describe("the gate", () => {
    it("runs hashing, verifying and the dummy check through the gate", async () => {
      let calls = 0;
      const gate: TaskGate = {
        run: (task) => {
          calls++;
          return task();
        },
      };
      const gated = createPasswordHasher({ params: CHEAP, gate });

      const hash = await gated.hash("gated password 123");
      const afterHash = calls;
      await gated.verify(hash, "gated password 123");
      const afterVerify = calls;
      await gated.verifyAgainstDummy("anything at all");

      expect(afterHash).toBeGreaterThanOrEqual(1);
      expect(afterVerify).toBeGreaterThan(afterHash);
      expect(calls).toBeGreaterThan(afterVerify);
    });

    it("passes the gate's rejection on to the caller", async () => {
      const busy = new Error("busy");
      const gated = createPasswordHasher({
        params: CHEAP,
        gate: { run: () => Promise.reject(busy) },
      });
      await expect(gated.hash("gated password 123")).rejects.toBe(busy);
      await expect(gated.verify("$argon2id$x", "gated password 123")).rejects.toBe(busy);
    });
  });

  describe("verifyAgainstDummy", () => {
    it("resolves without a result and without throwing, for any input", async () => {
      await expect(hasher.verifyAgainstDummy("some password")).resolves.toBeUndefined();
      await expect(hasher.verifyAgainstDummy("")).resolves.toBeUndefined();
      await expect(hasher.verifyAgainstDummy("😀".repeat(128))).resolves.toBeUndefined();
    });

    it("handles many concurrent calls", async () => {
      await expect(
        Promise.all(Array.from({ length: 10 }, (_, i) => hasher.verifyAgainstDummy(`pw-${i}`))),
      ).resolves.toHaveLength(10);
    });
  });
});
