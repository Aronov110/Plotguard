import { describe, expect, it } from "vitest";
import {
  makeAnalysis,
  makeFailed,
  makeFinding,
  makeIdea,
  makeIdeasAnalysis,
  makeIdeasSucceeded,
  makeSucceeded,
} from "../../../test-support/analyses-handlers.ts";
import {
  countFindings,
  countIdeas,
  describeScope,
  formatRunTime,
  kindWord,
  statusWord,
} from "../describe-run.ts";

describe("formatRunTime", () => {
  it("gives the date and the time in the zone asked for", () => {
    expect(formatRunTime("2026-11-12T10:05:00.000Z", "en-GB", "UTC")).toBe("12 Nov 2026, 10:05");
    expect(formatRunTime("2026-11-12T23:30:00.000Z", "en-GB", "Asia/Tokyo")).toBe(
      "13 Nov 2026, 08:30",
    );
  });

  it("gives nothing for something that is not a date", () => {
    expect(formatRunTime("not a date")).toBeUndefined();
    expect(formatRunTime("")).toBeUndefined();
  });
});

describe("describeScope", () => {
  const titles = new Map([["doc-1", "The harbour"]]);

  it("says the whole project for a run on everything", () => {
    expect(describeScope(makeAnalysis({ scope: "project" }), titles)).toBe("the whole project");
  });

  it("names the item, in quotes, when it is still in the outline", () => {
    expect(describeScope(makeAnalysis({ scope: "document", documentId: "doc-1" }), titles)).toBe(
      "“The harbour”",
    );
  });

  it("says the item has been deleted when it is not in the outline or the run has no id", () => {
    expect(describeScope(makeAnalysis({ scope: "document", documentId: "gone" }), titles)).toBe(
      "an item that has since been deleted",
    );
    expect(describeScope(makeAnalysis({ scope: "document", documentId: null }), titles)).toBe(
      "an item that has since been deleted",
    );
  });

  it("is not fooled by an id that every object has", () => {
    expect(
      describeScope(makeAnalysis({ scope: "document", documentId: "constructor" }), titles),
    ).toBe("an item that has since been deleted");
  });
});

describe("countFindings", () => {
  it("says there are none", () => {
    expect(countFindings([])).toBe("No findings.");
  });

  it("counts each severity, most serious first, leaving out the empty ones", () => {
    expect(
      countFindings([
        makeFinding({ severity: "minor" }),
        makeFinding({ severity: "major" }),
        makeFinding({ severity: "minor" }),
      ]),
    ).toBe("3 findings: 1 major, 2 minor.");
  });

  it("uses the singular for one", () => {
    expect(countFindings([makeFinding({ severity: "moderate" })])).toBe("1 finding: 1 moderate.");
  });
});

describe("statusWord", () => {
  it("says running, how many findings, or that it did not finish", () => {
    expect(statusWord(makeAnalysis())).toBe("running");
    expect(statusWord(makeSucceeded([]))).toBe("no findings");
    expect(statusWord(makeSucceeded([makeFinding()]))).toBe("1 finding");
    expect(statusWord(makeSucceeded([makeFinding(), makeFinding()]))).toBe("2 findings");
    expect(statusWord(makeFailed("timeout"))).toBe("did not finish");
  });

  it("says cancelled for a run the writer stopped", () => {
    expect(statusWord(makeFailed("canceled"))).toBe("cancelled");
  });
});

describe("statusWord for ideas", () => {
  it("says running, how many ideas, or that it did not finish", () => {
    expect(statusWord(makeIdeasAnalysis())).toBe("running");
    expect(statusWord(makeIdeasSucceeded([]))).toBe("no ideas");
    expect(statusWord(makeIdeasSucceeded([makeIdea()]))).toBe("1 idea");
    expect(statusWord(makeIdeasSucceeded([makeIdea(), makeIdea()]))).toBe("2 ideas");
    expect(statusWord(makeIdeasAnalysis({ status: "failed", errorCode: "timeout" }))).toBe(
      "did not finish",
    );
  });

  it("says cancelled for an idea request the writer stopped", () => {
    expect(statusWord(makeIdeasAnalysis({ status: "failed", errorCode: "canceled" }))).toBe(
      "cancelled",
    );
  });

  it("does not say findings for ideas", () => {
    expect(statusWord(makeIdeasSucceeded([makeIdea()]))).not.toContain("finding");
  });
});

describe("countIdeas", () => {
  it("counts in words", () => {
    expect(countIdeas([])).toBe("No ideas.");
    expect(countIdeas([makeIdea()])).toBe("1 idea.");
    expect(countIdeas([makeIdea(), makeIdea(), makeIdea()])).toBe("3 ideas.");
  });
});

describe("kindWord", () => {
  it("names the kind of run for the history", () => {
    expect(kindWord("plot_holes")).toBe("Plot holes");
    expect(kindWord("ideas")).toBe("Ideas");
  });
});
