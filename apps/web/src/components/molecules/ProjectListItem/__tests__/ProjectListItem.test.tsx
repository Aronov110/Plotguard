import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { makeProject } from "../../../../test-support/projects-handlers.ts";
import { ProjectListItem, projectItemId } from "../ProjectListItem.tsx";

function renderItem(overrides: Parameters<typeof makeProject>[0] = {}) {
  const project = makeProject(overrides);
  const view = render(
    <ul>
      <ProjectListItem project={project} />
    </ul>,
  );
  return { project, ...view };
}

describe("ProjectListItem", () => {
  it("is a list item with the title as a level-three heading", () => {
    const { project } = renderItem({ title: "The Lighthouse" });
    const item = screen.getByRole("listitem");
    expect(within(item).getByRole("heading", { level: 3, name: "The Lighthouse" })).toBeVisible();
    expect(item).toHaveAttribute("id", projectItemId(project.id));
  });

  it.each([
    ["screenplay", "Screenplay"],
    ["prose", "Prose"],
    ["other", "Other"],
  ] as const)("says the format %s in words", (format, words) => {
    renderItem({ format });
    expect(screen.getByRole("listitem")).toHaveTextContent(words);
  });

  it("shows when it last changed, as a date a machine can read too", () => {
    renderItem({ updatedAt: "2026-11-07T12:00:00.000Z" });
    const time = screen.getByRole("listitem").querySelector("time");
    expect(time).toHaveAttribute("datetime", "2026-11-07T12:00:00.000Z");
    expect(time?.textContent).toMatch(/2026/);
    expect(screen.getByRole("listitem")).toHaveTextContent(/Changed .*2026/);
  });

  it("leaves the date out when the timestamp is not a date, instead of 'Invalid Date'", () => {
    renderItem({ updatedAt: "not a date" });
    const item = screen.getByRole("listitem");
    expect(item.querySelector("time")).toBeNull();
    expect(item).not.toHaveTextContent("Invalid");
    expect(item).not.toHaveTextContent("Changed");
  });

  it("shows the logline when there is one", () => {
    renderItem({ logline: "A keeper finds a message in a bottle." });
    expect(screen.getByText("A keeper finds a message in a bottle.")).toBeVisible();
  });

  it.each([
    ["none", null],
    ["empty", ""],
    ["only spaces", "   "],
  ])("shows no logline paragraph when it is %s", (_name, logline) => {
    renderItem({ logline });
    expect(screen.getByRole("listitem").querySelectorAll("p")).toHaveLength(1);
  });

  it("can be focused by code, but is not in the tab order", () => {
    renderItem();
    const item = screen.getByRole("listitem");
    expect(item).toHaveAttribute("tabindex", "-1");
    item.focus();
    expect(item).toHaveFocus();
  });

  it("shows markup in the title and logline as text, never as markup", () => {
    renderItem({
      title: "<script>window.hacked = 1</script><b>Bold</b>",
      logline: '<img src=x onerror="window.hacked = 1"> & <i>italic</i>',
    });
    const item = screen.getByRole("listitem");
    expect(item.querySelector("script, b, img, i")).toBeNull();
    expect(item).toHaveTextContent("<script>window.hacked = 1</script><b>Bold</b>");
    expect(item).toHaveTextContent('<img src=x onerror="window.hacked = 1"> & <i>italic</i>');
    expect((window as unknown as { hacked?: number }).hacked).toBeUndefined();
  });

  it("shows right-to-left, emoji and very long text as it is", () => {
    const long = "w".repeat(1000);
    renderItem({ title: "שלום 🎬 مرحبا", logline: long });
    const item = screen.getByRole("listitem");
    expect(item).toHaveTextContent("שלום 🎬 مرحبا");
    expect(item).toHaveTextContent(long);
  });

  it("keeps line breaks in a logline (the style does it; the text keeps them)", () => {
    renderItem({ logline: "One.\nTwo." });
    expect(screen.getByText(/One\./).textContent).toBe("One.\nTwo.");
  });

  it("has no accessibility violations", async () => {
    const { container } = renderItem({ logline: "A logline." });
    await expectNoA11yViolations(container);
  });
});

describe("projectItemId", () => {
  it("builds the id from the project's id", () => {
    expect(projectItemId("abc")).toBe("project-abc");
  });
});
