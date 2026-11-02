import { describe, expect, it } from "vitest";
import {
  checkDisplayName,
  checkEmail,
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  normalizeDisplayName,
  normalizeEmail,
} from "../credentials.ts";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Mara.Writer@Example.COM \n")).toBe("mara.writer@example.com");
  });

  it("leaves a normal address alone", () => {
    expect(normalizeEmail("mara@example.com")).toBe("mara@example.com");
  });

  it("does not touch the inside of the address", () => {
    expect(normalizeEmail("a+tag@example.com")).toBe("a+tag@example.com");
  });
});

describe("checkEmail", () => {
  it.each([
    "mara@example.com",
    "a@b.co",
    "first.last@sub.example.org",
    "name+tag@example.com",
    "o'brien@example.com",
    "x_y-z@example-site.io",
    "123@456.com",
  ])("accepts %s", (email) => {
    expect(checkEmail(email)).toBe(true);
  });

  it.each([
    ["no at sign", "mara.example.com"],
    ["two at signs", "a@b@example.com"],
    ["no local part", "@example.com"],
    ["no domain", "mara@"],
    ["no dot in the domain", "mara@localhost"],
    ["a one-letter top-level domain", "mara@example.c"],
    ["a space inside", "ma ra@example.com"],
    ["a leading dot", ".mara@example.com"],
    ["two dots in a row", "ma..ra@example.com"],
    ["a trailing dot in the domain", "mara@example.com."],
    ["a hyphen at the start of a domain label", "mara@-example.com"],
    ["an empty string", ""],
    ["a tab", "mara\t@example.com"],
    ["a newline", "mara@example.com\n"],
    ["a NUL byte", "mara\u0000@example.com"],
    ["angle brackets and a name", "Mara <mara@example.com>"],
    ["a comma list", "a@example.com,b@example.com"],
    ["a quoted local part", '"mara"@example.com'],
  ])("rejects %s", (_label, email) => {
    expect(checkEmail(email)).toBe(false);
  });

  it.each([
    ["an accented local part", "mára@example.com"],
    ["a Cyrillic look-alike", "mаra@example.com"],
    ["an internationalised domain", "mara@münchen.de"],
    ["the Turkish dotted capital I", "İvan@example.com"],
    ["an emoji", "mara😀@example.com"],
    ["a full-width at sign", "mara＠example.com"],
  ])(
    "rejects non-ASCII: %s (lower-casing differs between JavaScript and Postgres)",
    (_l, email) => {
      expect(checkEmail(email.toLowerCase())).toBe(false);
    },
  );

  it("accepts a 254-character address and rejects 255", () => {
    const domain = `${"d".repeat(60)}.${"e".repeat(60)}.${"f".repeat(60)}.com`;
    const local = "a".repeat(EMAIL_MAX_LENGTH - domain.length - 1);
    const longest = `${local}@${domain}`;
    expect(longest).toHaveLength(EMAIL_MAX_LENGTH);
    // A local part over 64 characters is not valid by the RFC, so only the length rule is tested
    // with a shape that the pattern itself accepts.
    expect(checkEmail(`${"a".repeat(64)}@${"d".repeat(60)}.com`)).toBe(true);
    expect(checkEmail(`${longest}x`)).toBe(false);
  });

  it("rejects a local part over 64 characters", () => {
    expect(checkEmail(`${"a".repeat(65)}@example.com`)).toBe(false);
  });

  it("rejects a domain label over 63 characters", () => {
    expect(checkEmail(`a@${"d".repeat(64)}.com`)).toBe(false);
  });
});

describe("normalizeDisplayName", () => {
  it("trims the ends", () => {
    expect(normalizeDisplayName("  Mara  ")).toBe("Mara");
  });

  it("composes accents so the same name always looks the same", () => {
    expect(normalizeDisplayName("René")).toBe("René");
  });

  it("keeps inner spaces", () => {
    expect(normalizeDisplayName("Mara van der Berg")).toBe("Mara van der Berg");
  });
});

describe("checkDisplayName", () => {
  it("exposes the limit the database enforces", () => {
    expect(DISPLAY_NAME_MAX_LENGTH).toBe(80);
  });

  it.each([
    "M",
    "Mara",
    "Mara van der Berg",
    "日本語の名前",
    "Zoë 😀",
    "👩‍💻 Dev",
    "O'Brien-Smith Jr.",
    "a".repeat(80),
  ])("accepts %j", (name) => {
    expect(checkDisplayName(name)).toBeUndefined();
  });

  it("counts characters, not UTF-16 units: 80 emoji fit and 81 do not", () => {
    expect(checkDisplayName("😀".repeat(80))).toBeUndefined();
    expect(checkDisplayName("😀".repeat(81))).toBe("too-long");
  });

  it("rejects 81 ordinary characters", () => {
    expect(checkDisplayName("a".repeat(81))).toBe("too-long");
  });

  it("rejects an empty name and a name of spaces", () => {
    expect(checkDisplayName("")).toBe("too-short");
    expect(checkDisplayName("   ")).toBe("too-short");
  });

  it.each([
    ["a tab", "Ma\tra"],
    ["a newline", "Ma\nra"],
    ["a NUL byte", "Ma\u0000ra"],
    ["an escape", "Ma\u001Bra"],
    ["DEL", "Ma\u007Fra"],
    ["a C1 control", "Ma\u0085ra"],
  ])("rejects %s", (_label, name) => {
    expect(checkDisplayName(name)).toBe("control-character");
  });

  it("rejects a lone surrogate", () => {
    expect(checkDisplayName("Ma\uD800ra")).toBe("malformed-unicode");
  });

  it("judges the trimmed name, so padding cannot push a name over the limit", () => {
    expect(checkDisplayName(`  ${"a".repeat(80)}  `)).toBeUndefined();
  });
});
