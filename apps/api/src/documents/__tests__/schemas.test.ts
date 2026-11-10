import { describe, expect, it } from "vitest";
import { createDocumentBodySchema, patchDocumentBodySchema } from "../schemas.ts";

const uuid = "0190a0a0-0000-7000-8000-000000000000";

describe("createDocumentBodySchema", () => {
  it("needs only a title", () => {
    expect(createDocumentBodySchema.safeParse({ title: "Act" }).success).toBe(true);
  });

  it("trims the title", () => {
    const result = createDocumentBodySchema.parse({ title: "  Act  " });
    expect(result.title).toBe("Act");
  });

  it("accepts a parent, a position and text", () => {
    const result = createDocumentBodySchema.safeParse({
      title: "Scene",
      parentId: uuid,
      position: 0,
      content: "text",
    });
    expect(result.success).toBe(true);
  });

  it("accepts null as the parent (the top level)", () => {
    expect(createDocumentBodySchema.safeParse({ title: "A", parentId: null }).success).toBe(true);
  });

  it("keeps the text untouched", () => {
    const text = "  spaces and\r\nlines  ";
    expect(createDocumentBodySchema.parse({ title: "A", content: text }).content).toBe(text);
  });

  it.each([
    ["unknown field", { title: "A", version: 3 }],
    ["no title", {}],
    ["blank title", { title: "  " }],
    ["bad parent", { title: "A", parentId: "x" }],
    ["negative position", { title: "A", position: -1 }],
    ["fractional position", { title: "A", position: 0.5 }],
    ["huge position", { title: "A", position: 5000 }],
    ["NUL in text", { title: "A", content: "a\u0000" }],
    ["lone surrogate", { title: "A", content: "a\ud83d" }],
    ["lone low surrogate", { title: "A", content: "\ude00a" }],
    ["too long", { title: "A", content: "a".repeat(200_001) }],
    ["text is a number", { title: "A", content: 1 }],
  ])("refuses %s", (_name, body) => {
    expect(createDocumentBodySchema.safeParse(body).success).toBe(false);
  });

  it("stops at the length check: a far too long text is reported once, not once per rule", () => {
    // Over the length ceiling AND holding a NUL and a lone surrogate. Without `abort` on the length
    // check, the later rules would run over the whole string and each add an issue.
    const text = `${"a".repeat(800_001)}\u0000\ud83d`;
    const result = createDocumentBodySchema.safeParse({ title: "A", content: text });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual(["The text is too long."]);
  });

  it("accepts a complete emoji and 200,000 characters", () => {
    expect(createDocumentBodySchema.safeParse({ title: "A", content: "😀" }).success).toBe(true);
    expect(
      createDocumentBodySchema.safeParse({ title: "A", content: "a".repeat(200_000) }).success,
    ).toBe(true);
    expect(
      createDocumentBodySchema.safeParse({ title: "A", content: "😀".repeat(200_000) }).success,
    ).toBe(true);
  });
});

describe("patchDocumentBodySchema", () => {
  it.each([
    { title: "New" },
    { content: "" },
    { parentId: null },
    { position: 0 },
    { title: "A", content: "b", parentId: uuid, position: 2 },
  ])("accepts %j", (body) => {
    expect(patchDocumentBodySchema.safeParse(body).success).toBe(true);
  });

  it("refuses an empty body", () => {
    const result = patchDocumentBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("refuses a body whose only keys are undefined", () => {
    expect(patchDocumentBodySchema.safeParse({ title: undefined }).success).toBe(false);
  });

  it("refuses unknown fields", () => {
    expect(patchDocumentBodySchema.safeParse({ title: "A", wordCount: 5 }).success).toBe(false);
  });
});
