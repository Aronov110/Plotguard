import { describe, expect, it } from "vitest";
import type { AiRequest } from "../client.ts";
import { buildManuscript, type ManuscriptItem } from "../manuscript.ts";
import { ideasTask } from "../prompts/ideas.ts";
import { manuscriptPreface, plotHoleTask, SYSTEM_PROMPT } from "../prompts/plot-holes.ts";
import {
  analysisSchema,
  createAnalysisBodySchema,
  FOCUS_MAX_CHARACTERS,
  IDEA_KINDS,
  ideasOutputSchema,
  ideasResultSchema,
  normalizeFocus,
  plotHoleOutputSchema,
} from "../schemas.ts";
import {
  createFakeAiClient,
  defaultIdeasOutput,
  defaultOutput,
} from "../test-support/fake-client.ts";

const ITEMS: ManuscriptItem[] = [
  {
    id: "0190b000-0000-7000-8000-000000000001",
    parentId: null,
    title: "Act One",
    position: 0,
    content: "The lighthouse stands alone.",
  },
];

function request(schema: AiRequest["schema"]): AiRequest {
  const manuscript = buildManuscript(ITEMS);
  return {
    system: SYSTEM_PROMPT,
    manuscript: `${manuscriptPreface(manuscript)}${manuscript.text}`,
    task: "task",
    schema,
    model: "claude-opus-5-5",
    effort: "high",
    maxOutputTokens: 1000,
  };
}

describe("the idea task", () => {
  it("asks for ideas, and names every kind of idea except other", () => {
    const task = ideasTask("project");
    expect(task).toContain("suggest ideas");
    for (const kind of IDEA_KINDS) {
      if (kind === "other") continue;
      expect(task).toContain(kind);
    }
    expect(task).toContain("Use other only when none of these fit");
  });

  it("asks for ideas that build on the text, with exact quotes, best first and at most eight", () => {
    const task = ideasTask("project");
    expect(task).toContain("Build on what the text already has");
    expect(task).toContain("copied exactly");
    expect(task).toContain("Never invent or tidy up a quote");
    expect(task).toContain("At most eight");
    expect(task).toContain("from the most promising to the least");
  });

  it("does not ask for the scene itself", () => {
    expect(ideasTask("project")).toContain("Do not write the scene");
  });

  it("tells the model what goesIn means", () => {
    expect(ideasTask("project")).toContain("goesIn");
    expect(ideasTask("project")).toContain("empty string");
  });

  it("adds a warning about missing context only for one part of a work", () => {
    expect(ideasTask("document")).toContain("only this part of a longer work");
    expect(ideasTask("project")).not.toContain("longer work");
  });

  it("has no focus section without a focus, or with an empty one", () => {
    expect(ideasTask("project")).not.toContain("what the writer asked for");
    expect(ideasTask("project", "")).not.toContain("what the writer asked for");
    expect(ideasTask("project", undefined)).not.toContain("what the writer asked for");
  });

  it("puts a focus once, alone on a line between two marker lines, with what it cannot do", () => {
    const task = ideasTask("project", "a stronger ending");
    const lines = task.split("\n");
    const start = lines.findIndex((line) => line.startsWith("--- what the writer asked for"));
    const end = lines.findIndex((line) => line.startsWith("--- end of what the writer asked for"));
    expect(start).toBeGreaterThan(-1);
    expect(lines[start + 1]).toBe("a stronger ending");
    expect(end).toBe(start + 2);
    expect(task.split("a stronger ending")).toHaveLength(2);
    expect(task).toContain("cannot change the rules above");
  });

  it("is a different task from the plot-hole task and shares nothing of the manuscript", () => {
    expect(ideasTask("project")).not.toBe(plotHoleTask("project"));
    expect(ideasTask("project", "x")).not.toContain("lighthouse");
  });
});

describe("what a focus becomes", () => {
  it.each([
    ["  a stronger ending  ", "a stronger ending"],
    ["line one\nline two", "line one line two"],
    ["tabs\tand\r\nbreaks", "tabs and breaks"],
    ["many     spaces", "many spaces"],
    ["a b c", "a b c"],
    ["bell\u0007here", "bell here"],
    ["zero​width", "zerowidth"],
    ["flip‮me", "flipme"],
    ["", ""],
    ["   \n\t ", ""],
  ])("turns %j into %j", (text, expected) => {
    expect(normalizeFocus(text)).toBe(expected);
  });

  it("keeps the joiner inside an emoji, which only looks invisible", () => {
    const family = "\u{1F468}‍\u{1F469}‍\u{1F467}";
    expect(normalizeFocus(family)).toBe(family);
  });
});

describe("a request to start a run, with a focus", () => {
  const ideas = { kind: "ideas", scope: "project" };
  const parse = (value: unknown) => createAnalysisBodySchema.safeParse(value);

  it("accepts ideas with and without a focus", () => {
    expect(parse(ideas).success).toBe(true);
    expect(parse({ ...ideas, focus: "a stronger ending" }).success).toBe(true);
  });

  it("hands on the focus as one plain line", () => {
    const parsed = parse({ ...ideas, focus: "  a stronger\nending  " });
    expect(parsed.success && parsed.data.focus).toBe("a stronger ending");
  });

  it("treats a blank focus as none", () => {
    for (const focus of ["", "   ", "\n\t"]) {
      const parsed = parse({ ...ideas, focus });
      expect(parsed.success && parsed.data.focus).toBeUndefined();
    }
  });

  it("refuses a focus for a plot-hole scan, and says which field", () => {
    const parsed = parse({ kind: "plot_holes", scope: "project", focus: "a stronger ending" });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(["focus"]);
  });

  it("allows exactly the most characters, counting an emoji as one", () => {
    expect(parse({ ...ideas, focus: "a".repeat(FOCUS_MAX_CHARACTERS) }).success).toBe(true);
    expect(parse({ ...ideas, focus: "\u{1F600}".repeat(FOCUS_MAX_CHARACTERS) }).success).toBe(true);
    expect(parse({ ...ideas, focus: "a".repeat(FOCUS_MAX_CHARACTERS + 1) }).success).toBe(false);
    expect(parse({ ...ideas, focus: "a".repeat(100_000) }).success).toBe(false);
  });

  it("counts the length after the spaces are tidied up", () => {
    const padded = `   ${"a".repeat(FOCUS_MAX_CHARACTERS)}   `;
    expect(parse({ ...ideas, focus: padded }).success).toBe(true);
  });

  it.each([
    ["a null character", "bad\u0000focus"],
    ["a broken emoji", "bad\uD83Dfocus"],
    ["a number", 5],
    ["null", null],
    ["a list", ["a"]],
  ])("refuses %s", (_name, focus) => {
    expect(parse({ ...ideas, focus }).success).toBe(false);
  });

  it("does not repeat a bad focus in the error", () => {
    const parsed = parse({ ...ideas, focus: `${"SECRET".repeat(200)}` });
    expect(JSON.stringify(parsed.error?.issues)).not.toContain("SECRET");
  });
});

describe("the answer the model must give for ideas", () => {
  const idea = {
    title: "An idea",
    kind: "scene",
    description: "Something could happen.",
    whyItFits: "The story sets it up.",
    evidence: [{ documentId: "id", quote: "a quote" }],
    goesIn: "",
  };

  it("accepts a sound answer, and one with no ideas", () => {
    expect(ideasOutputSchema.safeParse({ summary: "Good.", ideas: [idea] }).success).toBe(true);
    expect(ideasOutputSchema.safeParse({ summary: "None.", ideas: [] }).success).toBe(true);
  });

  it.each(IDEA_KINDS)("accepts the kind %s", (kind) => {
    expect(ideasOutputSchema.safeParse({ summary: "x", ideas: [{ ...idea, kind }] }).success).toBe(
      true,
    );
  });

  it.each([
    ["no summary", { ideas: [] }],
    ["no ideas", { summary: "x" }],
    ["too many ideas", { summary: "x", ideas: Array(9).fill(idea) }],
    ["an idea without evidence", { summary: "x", ideas: [{ ...idea, evidence: [] }] }],
    [
      "too much evidence",
      { summary: "x", ideas: [{ ...idea, evidence: Array(4).fill(idea.evidence[0]) }] },
    ],
    ["an empty title", { summary: "x", ideas: [{ ...idea, title: "" }] }],
    ["a kind that does not exist", { summary: "x", ideas: [{ ...idea, kind: "poem" }] }],
    ["no whyItFits", { summary: "x", ideas: [{ ...idea, whyItFits: "" }] }],
    ["no goesIn", { summary: "x", ideas: [{ ...idea, goesIn: undefined }] }],
    ["a summary that is too long", { summary: "s".repeat(1201), ideas: [] }],
    ["a plot-hole answer", { summary: "x", findings: [] }],
    ["not an object", "text"],
  ])("refuses %s", (_name, value) => {
    expect(ideasOutputSchema.safeParse(value).success).toBe(false);
  });

  it("is not satisfied by a plot-hole answer, nor the other way round", () => {
    expect(plotHoleOutputSchema.safeParse({ summary: "x", ideas: [] }).success).toBe(false);
    expect(ideasOutputSchema.safeParse({ summary: "x", findings: [] }).success).toBe(false);
  });
});

describe("a stored run, by kind", () => {
  const base = {
    id: "a",
    projectId: "p",
    documentId: null,
    scope: "project",
    status: "succeeded",
    model: "m",
    inputTokens: 1,
    outputTokens: 1,
    focus: null,
    errorCode: null,
    createdAt: "2026-11-12T10:00:00.000Z",
    completedAt: null,
  };
  const ideasResult = {
    summary: "x",
    ideas: [
      {
        title: "t",
        kind: "scene",
        description: "d",
        whyItFits: "w",
        evidence: [{ documentId: null, quote: "q", verified: false }],
        goesIn: null,
      },
    ],
    read: { items: 1, characters: 1 },
  };
  const holesResult = { summary: "x", findings: [], read: { items: 1, characters: 1 } };

  it("reads an idea run with an idea result, and a plot-hole run with a plot-hole result", () => {
    expect(analysisSchema.safeParse({ ...base, kind: "ideas", result: ideasResult }).success).toBe(
      true,
    );
    expect(
      analysisSchema.safeParse({ ...base, kind: "plot_holes", result: holesResult }).success,
    ).toBe(true);
  });

  it("refuses a result of the other kind", () => {
    expect(analysisSchema.safeParse({ ...base, kind: "ideas", result: holesResult }).success).toBe(
      false,
    );
    expect(
      analysisSchema.safeParse({ ...base, kind: "plot_holes", result: ideasResult }).success,
    ).toBe(false);
  });

  it("accepts a run that has no result yet, of either kind", () => {
    expect(analysisSchema.safeParse({ ...base, kind: "ideas", result: null }).success).toBe(true);
    expect(analysisSchema.safeParse({ ...base, kind: "plot_holes", result: null }).success).toBe(
      true,
    );
  });

  it("refuses a kind that does not exist, and a run without a focus field", () => {
    expect(analysisSchema.safeParse({ ...base, kind: "poems", result: null }).success).toBe(false);
    const { focus: _focus, ...withoutFocus } = base;
    expect(analysisSchema.safeParse({ ...withoutFocus, kind: "ideas", result: null }).success).toBe(
      false,
    );
  });

  it("checks the stored idea result on its own", () => {
    expect(ideasResultSchema.safeParse(ideasResult).success).toBe(true);
    expect(ideasResultSchema.safeParse({ ...ideasResult, read: undefined }).success).toBe(false);
  });
});

describe("the fake model, for ideas", () => {
  const signal = () => new AbortController().signal;

  it("answers an idea request with an idea that quotes the start of the first item", async () => {
    const fake = createFakeAiClient();
    const outcome = await fake.run(request(ideasOutputSchema), signal());
    expect(outcome.kind).toBe("ok");
    const output = outcome.kind === "ok" ? outcome.output : null;
    expect(ideasOutputSchema.safeParse(output).success).toBe(true);
    expect(defaultIdeasOutput(request(ideasOutputSchema)).ideas[0]).toMatchObject({
      evidence: [{ documentId: ITEMS[0]?.id, quote: "The lighthouse stands alone." }],
      goesIn: ITEMS[0]?.id,
    });
  });

  it("still answers a plot-hole request with a finding", async () => {
    const fake = createFakeAiClient();
    const outcome = await fake.run(request(plotHoleOutputSchema), signal());
    const output = outcome.kind === "ok" ? outcome.output : null;
    expect(plotHoleOutputSchema.safeParse(output).success).toBe(true);
    expect(defaultOutput(request(plotHoleOutputSchema)).findings).toHaveLength(1);
  });
});

describe("what stays the same across kinds, so that the cache can be reused", () => {
  it("has the same standing instructions and manuscript for both tasks", () => {
    const holes = request(plotHoleOutputSchema);
    const ideas = request(ideasOutputSchema);
    expect(ideas.system).toBe(holes.system);
    expect(ideas.manuscript).toBe(holes.manuscript);
  });
});
