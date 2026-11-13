import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { ProjectBar, type ProjectBarProps } from "../ProjectBar.tsx";

function renderBar(props: Partial<ProjectBarProps> = {}) {
  const all: ProjectBarProps = {
    title: "The Lighthouse",
    outlineOpen: true,
    outlineId: "outline-panel",
    onToggleOutline: () => undefined,
    aiOpen: false,
    aiId: "ai-panel",
    onToggleAi: () => undefined,
    aiToggleRef: createRef<HTMLButtonElement>(),
    ...props,
  };
  return render(
    <MemoryRouter>
      <ProjectBar {...all} />
      {/* The panels the buttons control, which the screen provides. */}
      <div id="outline-panel" />
      <div id="ai-panel" />
    </MemoryRouter>,
  );
}

describe("ProjectBar", () => {
  it("has the title as the level-one heading of the screen", () => {
    renderBar({ title: `A very long and winding title ${"x".repeat(200)}` });
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("A very long and winding title");
  });

  it("links back to the projects", () => {
    renderBar();
    expect(screen.getByRole("link", { name: "Back to your projects" })).toHaveAttribute(
      "href",
      "/app",
    );
  });

  it("shows the title as text, never as markup", () => {
    const { container } = renderBar({ title: "<img src=x onerror=alert(1)>" });
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("<img src=x");
  });

  it("has an Outline button that says whether the outline is open and what it controls", () => {
    const { rerender } = renderBar({ outlineOpen: true });
    const button = screen.getByRole("button", { name: "Outline" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-controls", "outline-panel");
    rerender(
      <MemoryRouter>
        <ProjectBar
          title="T"
          outlineOpen={false}
          outlineId="outline-panel"
          onToggleOutline={() => undefined}
          aiOpen={false}
          aiId="ai-panel"
          onToggleAi={() => undefined}
          aiToggleRef={createRef<HTMLButtonElement>()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "Outline" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("has an AI assistant button that says whether the drawer is open and what it controls", () => {
    renderBar({ aiOpen: true });
    const button = screen.getByRole("button", { name: "AI assistant" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-controls", "ai-panel");
  });

  it("tells the screen when a toggle is pressed", async () => {
    const onToggleOutline = vi.fn();
    const onToggleAi = vi.fn();
    renderBar({ onToggleOutline, onToggleAi });
    await userEvent.click(screen.getByRole("button", { name: "Outline" }));
    expect(onToggleOutline).toHaveBeenCalledTimes(1);
    expect(onToggleAi).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "AI assistant" }));
    expect(onToggleAi).toHaveBeenCalledTimes(1);
  });

  it("gives the screen the AI toggle, so the focus can return to it", () => {
    const ref = createRef<HTMLButtonElement>();
    renderBar({ aiToggleRef: ref });
    expect(ref.current).toBe(screen.getByRole("button", { name: "AI assistant" }));
  });

  it("can be used from the keyboard", async () => {
    const onToggleAi = vi.fn();
    renderBar({ onToggleAi });
    screen.getByRole("button", { name: "AI assistant" }).focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onToggleAi).toHaveBeenCalledTimes(2);
  });

  it("has no accessibility violations", async () => {
    const { container } = renderBar({ aiOpen: true });
    await expectNoA11yViolations(container);
  });
});
