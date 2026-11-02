import { randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT, UnsecuredJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  createAccessTokens,
  createCsrfTokens,
  generateRefreshToken,
  hashRefreshToken,
  isWellFormedRefreshToken,
} from "../tokens.ts";

const SECRET = "k3Y7mQ2vX9bR5tN8wZ1cL6hD4fJ0sA3gUe7Pq2OxVn8Rb5Tm";
const OTHER_SECRET = "Zx9Wv8Ut7Sr6Qp5On4Ml3Kj2Ih1Gf0Ed9Cb8Ba7Zy6Xw5Vu4Ts3Rq";
const USER_ID = "0190a000-0000-7000-8000-000000000001";
const encode = (secret: string) => new TextEncoder().encode(secret);
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** A clock the test can move. */
function clock(start = new Date("2026-11-02T12:00:00.000Z")) {
  let current = start;
  return {
    now: () => current,
    advance(seconds: number) {
      current = new Date(current.getTime() + seconds * 1000);
    },
    seconds: () => Math.floor(current.getTime() / 1000),
  };
}

function decode(token: string) {
  const [header, payload] = token.split(".");
  return {
    header: JSON.parse(Buffer.from(header ?? "", "base64url").toString()),
    payload: JSON.parse(Buffer.from(payload ?? "", "base64url").toString()),
  };
}

describe("access tokens", () => {
  describe("signing", () => {
    it("makes a three-part token with the expected header and claims", async () => {
      const time = clock();
      const tokens = createAccessTokens({ secret: SECRET, ttlSeconds: 900, now: time.now });
      const { token, expiresIn } = await tokens.sign(USER_ID);

      expect(token.split(".")).toHaveLength(3);
      const { header, payload } = decode(token);
      expect(header).toEqual({ alg: "HS256", typ: "at+jwt" });
      expect(payload).toMatchObject({
        sub: USER_ID,
        iss: "plotpal-api",
        aud: "plotpal-web",
        iat: time.seconds(),
        exp: time.seconds() + 900,
      });
      expect(payload.jti).toEqual(expect.any(String));
      expect(expiresIn).toBe(900);
    });

    it("gives every token its own id", async () => {
      const tokens = createAccessTokens({ secret: SECRET, ttlSeconds: 900 });
      const ids = new Set<string>();
      for (let i = 0; i < 50; i++) ids.add(decode((await tokens.sign(USER_ID)).token).payload.jti);
      expect(ids.size).toBe(50);
    });

    it("never puts the email or other personal data into the token", async () => {
      const tokens = createAccessTokens({ secret: SECRET, ttlSeconds: 900 });
      const { payload } = decode((await tokens.sign(USER_ID)).token);
      expect(Object.keys(payload).sort()).toEqual(["aud", "exp", "iat", "iss", "jti", "sub"]);
    });

    it("refuses to sign for something that is not a UUID", async () => {
      const tokens = createAccessTokens({ secret: SECRET, ttlSeconds: 900 });
      await expect(tokens.sign("not-a-uuid")).rejects.toThrow(TypeError);
      await expect(tokens.sign("")).rejects.toThrow(TypeError);
    });

    it("rejects a short secret and a bad lifetime when it is created", () => {
      expect(() => createAccessTokens({ secret: "a".repeat(31), ttlSeconds: 900 })).toThrow(
        RangeError,
      );
      for (const ttlSeconds of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() => createAccessTokens({ secret: SECRET, ttlSeconds })).toThrow(RangeError);
      }
    });
  });

  describe("verifying a good token", () => {
    it("returns the user id", async () => {
      const tokens = createAccessTokens({ secret: SECRET, ttlSeconds: 900 });
      const { token } = await tokens.sign(USER_ID);
      await expect(tokens.verify(token)).resolves.toEqual({ userId: USER_ID });
    });

    it("is valid right up to the expiry and for a few seconds of clock drift after it", async () => {
      const time = clock();
      const tokens = createAccessTokens({ secret: SECRET, ttlSeconds: 900, now: time.now });
      const { token } = await tokens.sign(USER_ID);

      time.advance(899);
      await expect(tokens.verify(token)).resolves.toBeDefined();
      time.advance(1 + 4);
      await expect(tokens.verify(token)).resolves.toBeDefined();
    });

    it("is refused once it has expired", async () => {
      const time = clock();
      const tokens = createAccessTokens({ secret: SECRET, ttlSeconds: 900, now: time.now });
      const { token } = await tokens.sign(USER_ID);
      time.advance(900 + 6);
      await expect(tokens.verify(token)).resolves.toBeUndefined();
    });

    it("is refused when it claims to be issued in the future", async () => {
      const time = clock();
      const signer = createAccessTokens({ secret: SECRET, ttlSeconds: 900, now: time.now });
      const { token } = await signer.sign(USER_ID);
      const earlier = createAccessTokens({
        secret: SECRET,
        ttlSeconds: 900,
        now: () => new Date(time.now().getTime() - 3600 * 1000),
      });
      await expect(earlier.verify(token)).resolves.toBeUndefined();
    });

    it("accepts a token issued a few seconds ahead of this server's clock", async () => {
      const time = clock();
      const signer = createAccessTokens({ secret: SECRET, ttlSeconds: 900, now: time.now });
      const { token } = await signer.sign(USER_ID);
      const slightlyBehind = createAccessTokens({
        secret: SECRET,
        ttlSeconds: 900,
        now: () => new Date(time.now().getTime() - 3000),
      });
      await expect(slightlyBehind.verify(token)).resolves.toBeDefined();
    });
  });

  describe("forged and broken tokens", () => {
    const tokens = createAccessTokens({ secret: SECRET, ttlSeconds: 900 });
    const nowSeconds = () => Math.floor(Date.now() / 1000);

    /** A correctly built token, with one thing wrong. */
    async function forge(
      overrides: {
        alg?: string;
        typ?: string | false;
        secret?: string;
        sub?: unknown;
        iss?: string;
        aud?: string;
        exp?: number | false;
        iat?: number | false;
      } = {},
    ): Promise<string> {
      const { alg = "HS256", typ = "at+jwt", secret = SECRET } = overrides;
      const claims: Record<string, unknown> = {
        sub: "sub" in overrides ? overrides.sub : USER_ID,
        iss: overrides.iss ?? "plotpal-api",
        aud: overrides.aud ?? "plotpal-web",
        jti: randomUUID(),
      };
      if (overrides.iat !== false) claims.iat = overrides.iat ?? nowSeconds();
      if (overrides.exp !== false) claims.exp = overrides.exp ?? nowSeconds() + 900;
      const header: Record<string, unknown> = { alg };
      if (typ !== false) header.typ = typ;
      return new SignJWT(claims).setProtectedHeader(header as { alg: string }).sign(encode(secret));
    }

    it("the forging helper makes a token that is accepted when nothing is wrong", async () => {
      await expect(tokens.verify(await forge())).resolves.toEqual({ userId: USER_ID });
    });

    it("rejects alg none", async () => {
      const unsecured = new UnsecuredJWT({
        sub: USER_ID,
        iss: "plotpal-api",
        aud: "plotpal-web",
        iat: nowSeconds(),
        exp: nowSeconds() + 900,
      }).encode();
      await expect(tokens.verify(unsecured)).resolves.toBeUndefined();
    });

    it("rejects alg none written by hand with an empty signature", async () => {
      const claims = {
        sub: USER_ID,
        iss: "plotpal-api",
        aud: "plotpal-web",
        iat: nowSeconds(),
        exp: nowSeconds() + 900,
      };
      for (const alg of ["none", "None", "NONE", "nOnE"]) {
        const token = `${b64({ alg, typ: "at+jwt" })}.${b64(claims)}.`;
        await expect(tokens.verify(token)).resolves.toBeUndefined();
      }
    });

    it("rejects HS512 even though the same secret signed it", async () => {
      await expect(tokens.verify(await forge({ alg: "HS512" }))).resolves.toBeUndefined();
    });

    it("rejects HS384", async () => {
      await expect(tokens.verify(await forge({ alg: "HS384" }))).resolves.toBeUndefined();
    });

    it("rejects an RS256 token (algorithm confusion)", async () => {
      const { privateKey, publicKey } = await generateKeyPair("RS256");
      const token = await new SignJWT({
        sub: USER_ID,
        iss: "plotpal-api",
        aud: "plotpal-web",
      })
        .setProtectedHeader({ alg: "RS256", typ: "at+jwt" })
        .setIssuedAt()
        .setExpirationTime("15m")
        .sign(privateKey);
      await expect(tokens.verify(token)).resolves.toBeUndefined();
      // Also when the attacker uses the public key text as an HMAC secret.
      const publicText = JSON.stringify(await exportJWK(publicKey));
      await expect(tokens.verify(await forge({ secret: publicText }))).resolves.toBeUndefined();
    });

    it("rejects a token signed with another secret", async () => {
      await expect(tokens.verify(await forge({ secret: OTHER_SECRET }))).resolves.toBeUndefined();
    });

    it("rejects a changed payload that keeps the old signature", async () => {
      const good = await forge();
      const [header, , signature] = good.split(".");
      const evilClaims = {
        sub: "0190a000-0000-7000-8000-0000000000ff",
        iss: "plotpal-api",
        aud: "plotpal-web",
        iat: nowSeconds(),
        exp: nowSeconds() + 900,
      };
      await expect(
        tokens.verify(`${header}.${b64(evilClaims)}.${signature}`),
      ).resolves.toBeUndefined();
    });

    it("rejects a changed signature", async () => {
      const good = await forge();
      const [header, payload, signature = ""] = good.split(".");
      // Change the FIRST signature character: all 6 of its bits count. The last character holds
      // 2 unused padding bits, so changing only those would leave the decoded signature identical.
      const first = signature.startsWith("A") ? "B" : "A";
      const changed = `${header}.${payload}.${first}${signature.slice(1)}`;
      await expect(tokens.verify(changed)).resolves.toBeUndefined();
    });

    it("rejects a changed header", async () => {
      const good = await forge();
      const [, payload, signature] = good.split(".");
      const header = b64({ alg: "HS256", typ: "at+jwt", kid: "x" });
      await expect(tokens.verify(`${header}.${payload}.${signature}`)).resolves.toBeUndefined();
    });

    it.each([
      ["an empty string", ""],
      ["one part", "abc"],
      ["two parts", "abc.def"],
      ["four parts", "a.b.c.d"],
      ["only dots", ".."],
      ["garbage", "not a token at all"],
      ["a JSON object", '{"sub":"x"}'],
      ["null text", "null"],
      ["a bearer prefix left on", "Bearer abc.def.ghi"],
    ])("rejects %s", async (_label, token) => {
      await expect(tokens.verify(token)).resolves.toBeUndefined();
    });

    it("rejects a truncated token at every length", async () => {
      const good = await forge();
      for (let length = 0; length < good.length; length += 17) {
        await expect(tokens.verify(good.slice(0, length))).resolves.toBeUndefined();
      }
    });

    it("rejects a valid token with spaces or a newline around it", async () => {
      const good = await forge();
      await expect(tokens.verify(` ${good}`)).resolves.toBeUndefined();
      await expect(tokens.verify(`${good} `)).resolves.toBeUndefined();
      await expect(tokens.verify(`${good}\n`)).resolves.toBeUndefined();
    });

    it("rejects a token that is too long before doing any work on it", async () => {
      await expect(tokens.verify(`${"a".repeat(3000)}.b.c`)).resolves.toBeUndefined();
      await expect(tokens.verify("a".repeat(1_000_000))).resolves.toBeUndefined();
    });

    it("rejects the wrong issuer and the wrong audience", async () => {
      await expect(tokens.verify(await forge({ iss: "someone-else" }))).resolves.toBeUndefined();
      await expect(tokens.verify(await forge({ aud: "another-app" }))).resolves.toBeUndefined();
    });

    it("rejects a wrong token type, or none at all", async () => {
      await expect(tokens.verify(await forge({ typ: "JWT" }))).resolves.toBeUndefined();
      await expect(tokens.verify(await forge({ typ: false }))).resolves.toBeUndefined();
    });

    it.each([
      ["a missing subject", undefined],
      ["a subject that is not a UUID", "not-a-uuid"],
      ["an empty subject", ""],
      ["a numeric subject", 12345],
      ["an object as the subject", { id: USER_ID }],
      ["a subject with trailing text", `${USER_ID}-extra`],
      ["a SQL-looking subject", "' OR '1'='1"],
    ])("rejects %s", async (_label, sub) => {
      await expect(tokens.verify(await forge({ sub }))).resolves.toBeUndefined();
    });

    it("rejects a token with no expiry, which would live forever", async () => {
      await expect(tokens.verify(await forge({ exp: false }))).resolves.toBeUndefined();
    });

    it("rejects a token with no issue time", async () => {
      await expect(tokens.verify(await forge({ iat: false }))).resolves.toBeUndefined();
    });

    it("rejects a token that lives far longer than ours do", async () => {
      const longLived = await forge({ exp: nowSeconds() + 10 * 365 * 24 * 3600 });
      await expect(tokens.verify(longLived)).resolves.toBeUndefined();
    });
  });
});

describe("refresh tokens", () => {
  it("are 32 random bytes written as 43 URL-safe characters", () => {
    for (let i = 0; i < 20; i++) {
      expect(generateRefreshToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it("never repeat in 10,000 draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) seen.add(generateRefreshToken());
    expect(seen.size).toBe(10_000);
  });

  it("hash to 64 lowercase hex characters, the format the database checks", () => {
    expect(hashRefreshToken(generateRefreshToken())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hash the same way every time, and differently for different tokens", () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(hashRefreshToken(a)).toBe(hashRefreshToken(a));
    expect(hashRefreshToken(a)).not.toBe(hashRefreshToken(b));
  });

  it("hash to a value that does not contain the token", () => {
    const token = generateRefreshToken();
    expect(hashRefreshToken(token)).not.toContain(token);
  });

  it("matches a known SHA-256 value", () => {
    expect(hashRefreshToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  describe("isWellFormedRefreshToken", () => {
    it("accepts a generated token", () => {
      expect(isWellFormedRefreshToken(generateRefreshToken())).toBe(true);
    });

    it.each([
      ["42 characters", "a".repeat(42)],
      ["44 characters", "a".repeat(44)],
      ["an empty string", ""],
      ["a standard base64 plus sign", `${"a".repeat(42)}+`],
      ["a standard base64 slash", `${"a".repeat(42)}/`],
      ["base64 padding", `${"a".repeat(42)}=`],
      ["a space", `${"a".repeat(42)} `],
      ["a newline at the end", `${"a".repeat(43)}\n`],
      ["a look-alike Unicode letter", `${"a".repeat(42)}а`],
      ["the word null", "null"],
      ["something huge", "a".repeat(1_000_000)],
    ])("rejects %s", (_label, value) => {
      expect(isWellFormedRefreshToken(value)).toBe(false);
    });
  });
});

describe("csrf tokens", () => {
  const csrf = createCsrfTokens(SECRET);
  const FAMILY = "11111111-1111-4111-8111-111111111111";
  const OTHER_FAMILY = "22222222-2222-4222-8222-222222222222";

  it("are 43 URL-safe characters", () => {
    expect(csrf.derive(FAMILY)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("are the same every time for the same login family", () => {
    expect(csrf.derive(FAMILY)).toBe(csrf.derive(FAMILY));
    expect(createCsrfTokens(SECRET).derive(FAMILY)).toBe(csrf.derive(FAMILY));
  });

  it("differ between families", () => {
    expect(csrf.derive(FAMILY)).not.toBe(csrf.derive(OTHER_FAMILY));
  });

  it("differ between secrets", () => {
    expect(createCsrfTokens(OTHER_SECRET).derive(FAMILY)).not.toBe(csrf.derive(FAMILY));
  });

  it("do not reveal the family id or the secret", () => {
    const token = csrf.derive(FAMILY);
    expect(token).not.toContain(FAMILY);
    expect(token).not.toContain(SECRET.slice(0, 8));
  });

  it("verify for the right family only", () => {
    expect(csrf.verify(FAMILY, csrf.derive(FAMILY))).toBe(true);
    expect(csrf.verify(OTHER_FAMILY, csrf.derive(FAMILY))).toBe(false);
  });

  it("do not verify under another secret", () => {
    expect(createCsrfTokens(OTHER_SECRET).verify(FAMILY, csrf.derive(FAMILY))).toBe(false);
  });

  it.each([
    ["undefined", undefined],
    ["an empty string", ""],
    ["a short value", "abc"],
    ["a long value", "a".repeat(44)],
    ["the right value with a newline", "NEWLINE"],
    ["non-ASCII text of the right length", "é".repeat(43)],
    ["null text", "null"],
    ["a megabyte of text", "a".repeat(1_000_000)],
  ])("refuse %s without throwing", (label, value) => {
    const candidate = label.includes("newline") ? `${csrf.derive(FAMILY)}\n` : value;
    expect(csrf.verify(FAMILY, candidate)).toBe(false);
  });

  it("refuse a value that differs in one character", () => {
    const good = csrf.derive(FAMILY);
    const last = good.endsWith("A") ? "B" : "A";
    expect(csrf.verify(FAMILY, good.slice(0, -1) + last)).toBe(false);
  });

  it("refuse a short secret when they are created", () => {
    expect(() => createCsrfTokens("a".repeat(31))).toThrow(RangeError);
  });
});
