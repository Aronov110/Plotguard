import { describe, expect, it } from "vitest";
import {
  createProjectBodySchema,
  LOGLINE_MAX_CHARACTERS,
  listQuerySchema,
  patchProjectBodySchema,
  projectParamsSchema,
  TITLE_MAX_CHARACTERS,
} from "../schemas.ts";

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

// The two halves of an emoji. Alone, a half cannot be stored as UTF-8: the database driver would
// silently write U+FFFD in its place. Built from code units so the source has no invisible characters.
const HIGH_SURROGATE = String.fromCharCode(0xd83d);
const LOW_SURROGATE = String.fromCharCode(0xde00);

describe("create project body: title", () => {
  const parse = (title: unknown) =>
    createProjectBodySchema.safeParse({ title, format: "screenplay" });

  it("accepts an ordinary title", () => {
    const result = parse("The Lighthouse");
    expect(result.success).toBe(true);
    expect(result.data?.title).toBe("The Lighthouse");
  });

  it("removes spaces and line breaks at both ends but keeps those inside", () => {
    expect(parse("  \t The  Lighthouse \n ").data?.title).toBe("The  Lighthouse");
  });

  it.each([
    ["empty", ""],
    ["only spaces", "     "],
    ["only tabs and line breaks", "\t\n\r"],
  ])("refuses a title that is %s", (_name, title) => {
    const result = parse(title);
    expect(result.success).toBe(false);
    expect(messages(result)).toContain("Enter a title.");
  });

  it("accepts one character", () => {
    expect(parse("x").success).toBe(true);
  });

  it("accepts exactly 200 characters", () => {
    expect(parse("a".repeat(TITLE_MAX_CHARACTERS)).success).toBe(true);
  });

  it("refuses 201 characters", () => {
    const result = parse("a".repeat(TITLE_MAX_CHARACTERS + 1));
    expect(result.success).toBe(false);
    expect(messages(result)).toContain("The title can be at most 200 characters.");
  });

  it("counts an emoji as one character, like the database", () => {
    expect(parse("😀".repeat(TITLE_MAX_CHARACTERS)).success).toBe(true);
    expect(parse("😀".repeat(TITLE_MAX_CHARACTERS + 1)).success).toBe(false);
  });

  it("counts letters with accents and other scripts as one character each", () => {
    expect(parse("é".repeat(200)).success).toBe(true);
    expect(parse("漢".repeat(200)).success).toBe(true);
    expect(parse("ö".repeat(201)).success).toBe(false);
  });

  it("counts the length after trimming", () => {
    expect(parse(` ${"a".repeat(200)} `).success).toBe(true);
  });

  it("refuses a title with a NUL character, which the database cannot store", () => {
    const result = parse("bad\u0000title");
    expect(result.success).toBe(false);
    expect(messages(result)).toContain("The title cannot contain a null character.");
  });

  it.each([
    ["a lone high surrogate", `broken ${HIGH_SURROGATE} emoji`],
    ["a lone low surrogate", `broken ${LOW_SURROGATE} emoji`],
    ["a high surrogate at the end", `a${HIGH_SURROGATE}`],
    ["a low surrogate at the start", `${LOW_SURROGATE}a`],
    ["two high surrogates in a row", `${HIGH_SURROGATE}${HIGH_SURROGATE}`],
    ["the halves in the wrong order", `${LOW_SURROGATE}${HIGH_SURROGATE}`],
  ])("refuses a title with %s, which would silently turn into U+FFFD", (_name, text) => {
    const result = parse(text);
    expect(result.success).toBe(false);
    expect(messages(result)).toContain("The title contains an invalid character.");
  });

  it("accepts a title with a whole emoji and with other characters outside the basic plane", () => {
    expect(parse("a 😀 b").success).toBe(true);
    expect(parse("𝒳𝒴𝒵").success).toBe(true);
    expect(parse(`${HIGH_SURROGATE}${LOW_SURROGATE}`).success).toBe(true);
  });

  it("refuses a huge title early", () => {
    expect(parse("a".repeat(1_000_000)).success).toBe(false);
  });

  it.each([
    ["a number", 5],
    ["null", null],
    ["a boolean", true],
    ["an array", ["a"]],
    ["an object", { a: 1 }],
    ["nothing", undefined],
  ])("refuses a title that is %s", (_name, title) => {
    expect(parse(title).success).toBe(false);
  });

  it("keeps characters that look dangerous as plain text", () => {
    const title = `<script>alert("x")</script> '; drop table projects; --`;
    expect(parse(title).data?.title).toBe(title);
  });
});

describe("create project body: format", () => {
  const parse = (format: unknown) => createProjectBodySchema.safeParse({ title: "T", format });

  it.each(["screenplay", "prose", "other"])("accepts %s", (format) => {
    expect(parse(format).success).toBe(true);
  });

  it.each([
    ["wrong case", "Screenplay"],
    ["upper case", "PROSE"],
    ["unknown", "poem"],
    ["empty", ""],
    ["with spaces", " prose "],
    ["a number", 1],
    ["null", null],
    ["nothing", undefined],
  ])("refuses a format that is %s", (_name, format) => {
    const result = parse(format);
    expect(result.success).toBe(false);
    expect(messages(result)).toContain("The format must be screenplay, prose or other.");
  });
});

describe("create project body: logline", () => {
  const parse = (logline: unknown) =>
    createProjectBodySchema.safeParse({ title: "T", format: "prose", logline });

  it("may be left out", () => {
    expect(createProjectBodySchema.safeParse({ title: "T", format: "prose" }).success).toBe(true);
  });

  it("may be null", () => {
    expect(parse(null).success).toBe(true);
    expect(parse(null).data?.logline).toBeNull();
  });

  it("accepts text and trims it", () => {
    expect(parse("  A keeper finds a letter.  ").data?.logline).toBe("A keeper finds a letter.");
  });

  it("accepts an empty or blank text (it is stored as no logline)", () => {
    expect(parse("").data?.logline).toBe("");
    expect(parse("   ").data?.logline).toBe("");
  });

  it("accepts exactly 1000 characters", () => {
    expect(parse("a".repeat(LOGLINE_MAX_CHARACTERS)).success).toBe(true);
  });

  it("refuses 1001 characters", () => {
    const result = parse("a".repeat(LOGLINE_MAX_CHARACTERS + 1));
    expect(result.success).toBe(false);
    expect(messages(result)).toContain("The logline can be at most 1000 characters.");
  });

  it("counts an emoji as one character", () => {
    expect(parse("😀".repeat(LOGLINE_MAX_CHARACTERS)).success).toBe(true);
    expect(parse("😀".repeat(LOGLINE_MAX_CHARACTERS + 1)).success).toBe(false);
  });

  it("refuses a NUL character", () => {
    expect(parse("a\u0000b").success).toBe(false);
  });

  it.each([
    ["a lone high surrogate", `x ${HIGH_SURROGATE} y`],
    ["a lone low surrogate", `x ${LOW_SURROGATE} y`],
    ["the halves in the wrong order", `${LOW_SURROGATE}${HIGH_SURROGATE}`],
  ])("refuses a logline with %s, which would silently turn into U+FFFD", (_name, text) => {
    const result = parse(text);
    expect(result.success).toBe(false);
    expect(messages(result)).toContain("The logline contains an invalid character.");
  });

  it("accepts a logline with a whole emoji", () => {
    expect(parse("A 😀 story").success).toBe(true);
    expect(parse(`${HIGH_SURROGATE}${LOW_SURROGATE}`).success).toBe(true);
  });

  it.each([
    ["a number", 5],
    ["a boolean", false],
    ["an array", []],
  ])("refuses a logline that is %s", (_name, logline) => {
    expect(parse(logline).success).toBe(false);
  });
});

describe("create project body: unknown fields", () => {
  it.each([
    "userId",
    "user_id",
    "id",
    "createdAt",
    "updatedAt",
    "documents",
    "isAdmin",
    "__proto__x",
  ])("refuses the extra field %s", (field) => {
    const result = createProjectBodySchema.safeParse({
      title: "T",
      format: "prose",
      [field]: "x",
    });
    expect(result.success).toBe(false);
  });

  it("refuses a body that is not an object", () => {
    expect(createProjectBodySchema.safeParse("text").success).toBe(false);
    expect(createProjectBodySchema.safeParse(null).success).toBe(false);
    expect(createProjectBodySchema.safeParse([]).success).toBe(false);
  });
});

describe("patch project body", () => {
  it.each([
    ["only a title", { title: "New" }],
    ["only a format", { format: "other" }],
    ["only a logline", { logline: "New logline" }],
    ["a logline cleared with null", { logline: null }],
    ["a blank logline", { logline: "  " }],
    ["everything", { title: "New", format: "prose", logline: "L" }],
  ])("accepts %s", (_name, body) => {
    expect(patchProjectBodySchema.safeParse(body).success).toBe(true);
  });

  it("refuses an empty body", () => {
    const result = patchProjectBodySchema.safeParse({});
    expect(result.success).toBe(false);
    expect(messages(result)).toContain("Send at least one of title, format or logline.");
  });

  it("refuses a body where every field is undefined", () => {
    expect(patchProjectBodySchema.safeParse({ title: undefined }).success).toBe(false);
  });

  it.each([
    ["a blank title", { title: "  " }],
    ["a 201 character title", { title: "a".repeat(201) }],
    ["a null title", { title: null }],
    ["a null format", { format: null }],
    ["an unknown format", { format: "poem" }],
    ["a 1001 character logline", { logline: "a".repeat(1001) }],
  ])("refuses %s", (_name, body) => {
    expect(patchProjectBodySchema.safeParse(body).success).toBe(false);
  });

  it("refuses unknown fields, also next to valid ones", () => {
    expect(patchProjectBodySchema.safeParse({ userId: "x" }).success).toBe(false);
    expect(patchProjectBodySchema.safeParse({ title: "T", userId: "x" }).success).toBe(false);
    expect(patchProjectBodySchema.safeParse({ title: "T", id: "x" }).success).toBe(false);
  });

  it("leaves out the keys that were not sent", () => {
    expect(Object.keys(patchProjectBodySchema.parse({ title: "T" }))).toEqual(["title"]);
  });
});

describe("project id parameter", () => {
  it.each([
    "019e5a3c-1b2d-7c4e-8f10-a1b2c3d4e5f6",
    "123e4567-e89b-12d3-a456-426614174000",
    "550e8400-e29b-41d4-a716-446655440000",
  ])("accepts the UUID %s", (id) => {
    expect(projectParamsSchema.safeParse({ id }).success).toBe(true);
  });

  it.each([
    "",
    "1",
    "abc",
    "not-a-uuid",
    "019e5a3c1b2d7c4e8f10a1b2c3d4e5f6",
    "019e5a3c-1b2d-7c4e-8f10-a1b2c3d4e5f6x",
    " 019e5a3c-1b2d-7c4e-8f10-a1b2c3d4e5f6",
    "019e5a3c-1b2d-7c4e-8f10-a1b2c3d4e5fg",
    "00000000-0000-0000-0000-00000000000",
    "../../etc/passwd",
    "1; drop table projects",
  ])("refuses %j", (id) => {
    const result = projectParamsSchema.safeParse({ id });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain("The project id must be a UUID.");
  });
});

describe("list query", () => {
  const parse = (query: Record<string, unknown>) => listQuerySchema.safeParse(query);

  it("accepts no parameters", () => {
    expect(parse({}).success).toBe(true);
    expect(parse({}).data?.limit).toBeUndefined();
  });

  it.each([
    ["1", 1],
    ["20", 20],
    ["99", 99],
    ["100", 100],
    ["007", 7],
  ])("accepts the limit %s", (text, number) => {
    expect(parse({ limit: text }).data?.limit).toBe(number);
  });

  it.each([
    "0",
    "000",
    "101",
    "999",
    "-1",
    "+5",
    "1.5",
    "1e1",
    "0x10",
    "abc",
    "",
    " 5",
    "5 ",
    "1000",
    "NaN",
    "Infinity",
  ])("refuses the limit %j", (limit) => {
    const result = parse({ limit });
    expect(result.success).toBe(false);
    expect(messages(result).join(" ")).toContain("from 1 to 100");
  });

  it("accepts a cursor text", () => {
    expect(parse({ cursor: "abc" }).data?.cursor).toBe("abc");
  });

  it("refuses an empty cursor and one that is far too long", () => {
    expect(parse({ cursor: "" }).success).toBe(false);
    expect(parse({ cursor: "a".repeat(513) }).success).toBe(false);
    expect(parse({ cursor: "a".repeat(512) }).success).toBe(true);
  });

  it("ignores parameters it does not know, such as tracking tags", () => {
    expect(parse({ utm_source: "x" }).success).toBe(true);
  });
});
