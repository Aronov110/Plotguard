import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { makeProject } from "../../../../test-support/projects-handlers.ts";
import { ProjectSummary } from "../ProjectSummary.tsx";

function renderSummary(overrides: Parameters<typeof makeProject>[0] = {}) {
  const project = makeProject(overrides);
  const view = render(
    <div data-testid="card">
      <ProjectSummary project={project} />
    </div>,
  );
  return { project, ...view };
}

const card = () => screen.getByTestId("card");

describe("ProjectSummary", () => {
  it("shows the title as a level-three heading", () => {
    renderSummary({ title: "The Lighthouse" });
    expect(screen.getByRole("heading", { level: 3, name: "The Lighthouse" })).toBeVisible();
  });

  it.each([
    ["screenplay", "Screenplay"],
    ["prose", "Prose"],
    ["other", "Other"],
  ] as const)("says the format %s in words", (format, words) => {
    renderSummary({ format });
    expect(card()).toHaveTextContent(words);
  });

  it("shows when it last changed, as a date a machine can read too", () => {
    renderSummary({ updatedAt: "2026-11-07T12:00:00.000Z" });
    const time = card().querySelector("time");
    expect(time).toHaveAttribute("datetime", "2026-11-07T12:00:00.000Z");
    expect(time?.textContent).toMatch(/2026/);
    expect(card()).toHaveTextContent(/Changed .*2026/);
  });

  it("leaves the date out when the timestamp is not a date, instead of 'Invalid Date'", () => {
    renderSummary({ updatedAt: "not a date" });
    expect(card().querySelector("time")).toBeNull();
    expect(card()).not.toHaveTextContent("Invalid");
    expect(card()).not.toHaveTextContent("Changed");
  });

  it("shows the logline when there is one", () => {
    renderSummary({ logline: "A keeper finds a message in a bottle." });
    expect(screen.getByText("A keeper finds a message in a bottle.")).toBeVisible();
  });

  it.each([
    ["none", null],
    ["empty", ""],
    ["only spaces", "   "],
  ])("shows no logline paragraph when it is %s", (_name, logline) => {
    renderSummary({ logline });
    expect(card().querySelectorAll("p")).toHaveLength(1);
  });

  it("shows markup in the title and logline as text, never as markup", () => {
    renderSummary({
      title: "<script>window.hacked = 1</script><b>Bold</b>",
      logline: '<img src=x onerror="window.hacked = 1"> & <i>italic</i>',
    });
    expect(card().querySelector("script, b, img, i")).toBeNull();
    expect(card()).toHaveTextContent("<script>window.hacked = 1</script><b>Bold</b>");
    expect(card()).toHaveTextContent('<img src=x onerror="window.hacked = 1"> & <i>italic</i>');
    expect((window as unknown as { hacked?: number }).hacked).toBeUndefined();
  });

  it("shows right-to-left, emoji and very long text as it is", () => {
    const long = "w".repeat(1000);
    renderSummary({ title: "שלום 🎬 مرحبا", logline: long });
    expect(card()).toHaveTextContent("שלום 🎬 مرحبا");
    expect(card()).toHaveTextContent(long);
  });

  it("keeps line breaks in a logline (the style does it; the text keeps them)", () => {
    renderSummary({ logline: "One.\nTwo." });
    expect(screen.getByText(/One\./).textContent).toBe("One.\nTwo.");
  });

  it("has no accessibility violations", async () => {
    const { container } = renderSummary({ logline: "A logline." });
    await expectNoA11yViolations(container);
  });
});
