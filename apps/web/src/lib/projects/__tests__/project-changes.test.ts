import { describe, expect, it } from "vitest";
import { makeProject } from "../../../test-support/projects-handlers.ts";
import { changedFields, type ProjectFormValues } from "../project-changes.ts";

const project = makeProject({
  title: "Lighthouse",
  format: "prose",
  logline: "A keeper finds a message.",
});

/** The form as it opens: the project's own values. */
const same: ProjectFormValues = {
  title: "Lighthouse",
  format: "prose",
  logline: "A keeper finds a message.",
};

describe("changedFields", () => {
  it("is nothing when nothing was changed", () => {
    expect(changedFields(project, same)).toBeUndefined();
  });

  it("sends only the title when only the title changed, as typed", () => {
    expect(changedFields(project, { ...same, title: "The Lighthouse" })).toEqual({
      title: "The Lighthouse",
    });
    expect(changedFields(project, { ...same, title: "  Padded  " })).toEqual({
      title: "  Padded  ",
    });
  });

  it("sends only the format when only the format changed", () => {
    expect(changedFields(project, { ...same, format: "other" })).toEqual({ format: "other" });
  });

  it("sends only the logline when only the logline changed", () => {
    expect(changedFields(project, { ...same, logline: "A new logline." })).toEqual({
      logline: "A new logline.",
    });
  });

  it("sends all three when all three changed", () => {
    expect(
      changedFields(project, { title: "New", format: "screenplay", logline: "New logline." }),
    ).toEqual({ title: "New", format: "screenplay", logline: "New logline." });
  });

  it("does not count spaces around the title as a change: the API trims it", () => {
    expect(changedFields(project, { ...same, title: "  Lighthouse  " })).toBeUndefined();
    expect(changedFields(project, { ...same, title: "Lighthouse\n" })).toBeUndefined();
  });

  it("counts a change inside the title, including its case", () => {
    expect(changedFields(project, { ...same, title: "lighthouse" })).toEqual({
      title: "lighthouse",
    });
  });

  it.each([
    ["empty", ""],
    ["only spaces", "   "],
    ["only line breaks", "\n\n"],
  ])("clears the logline with null when it is %s and the project has one", (_name, logline) => {
    expect(changedFields(project, { ...same, logline })).toEqual({ logline: null });
  });

  it.each([
    ["empty", ""],
    ["only spaces", "   "],
  ])("sends nothing when the logline is %s and the project has none", (_name, logline) => {
    const bare = makeProject({ title: "Bare", format: "other", logline: null });
    expect(changedFields(bare, { title: "Bare", format: "other", logline })).toBeUndefined();
  });

  it("adds a logline to a project that had none", () => {
    const bare = makeProject({ title: "Bare", format: "other", logline: null });
    expect(changedFields(bare, { title: "Bare", format: "other", logline: "Now one." })).toEqual({
      logline: "Now one.",
    });
  });

  it("compares the logline as it is: the API keeps it as sent", () => {
    expect(changedFields(project, { ...same, logline: "A keeper finds a message. " })).toEqual({
      logline: "A keeper finds a message. ",
    });
  });

  it("does not mix up a project whose logline is the empty text with one that has none", () => {
    const empty = makeProject({ title: "E", format: "other", logline: "" });
    expect(changedFields(empty, { title: "E", format: "other", logline: "" })).toBeUndefined();
  });

  it("treats very long, right-to-left and emoji text like any other", () => {
    const long = "ש".repeat(1000);
    expect(changedFields(project, { ...same, logline: long })).toEqual({ logline: long });
    expect(changedFields(project, { ...same, title: "🎬" })).toEqual({ title: "🎬" });
  });
});
