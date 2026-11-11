import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { makeProject } from "../../../../test-support/projects-handlers.ts";
import { ProjectSummary } from "../ProjectSummary.tsx";

describe("ProjectSummary: the title as a link", () => {
  it("is plain text without a destination", () => {
    render(<ProjectSummary project={makeProject({ title: "Lighthouse" })} />);
    expect(screen.getByRole("heading", { level: 3, name: "Lighthouse" })).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("is a link inside the heading when it has a destination", () => {
    render(
      <MemoryRouter>
        <ProjectSummary project={makeProject({ title: "Lighthouse" })} to="/app/projects/p1" />
      </MemoryRouter>,
    );
    const heading = screen.getByRole("heading", { level: 3, name: "Lighthouse" });
    expect(screen.getByRole("link", { name: "Lighthouse" })).toHaveAttribute(
      "href",
      "/app/projects/p1",
    );
    expect(heading).toContainElement(screen.getByRole("link"));
  });

  it("shows a title with markup as text, also as a link", () => {
    render(
      <MemoryRouter>
        <ProjectSummary project={makeProject({ title: "<b>Bold</b>" })} to="/x" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link")).toHaveTextContent("<b>Bold</b>");
    expect(document.querySelector("b")).toBeNull();
  });

  it("has no accessibility violations as a link", async () => {
    const { container } = render(
      <MemoryRouter>
        <ProjectSummary project={makeProject({ logline: "A logline." })} to="/app/projects/p1" />
      </MemoryRouter>,
    );
    await expectNoA11yViolations(container);
  });
});
