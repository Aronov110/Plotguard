import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { buildTree } from "../../../../lib/documents/use-outline.ts";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { makeOutlineItem } from "../../../../test-support/documents-handlers.ts";
import { OutlineNav } from "../OutlineNav.tsx";

function renderNav(headingRef = createRef<HTMLHeadingElement>(), nodes = buildTree([])) {
  const view = render(
    <MemoryRouter>
      <OutlineNav
        nodes={nodes}
        selectedId={undefined}
        onSelect={() => undefined}
        headingRef={headingRef}
      />
    </MemoryRouter>,
  );
  return { ...view, headingRef };
}

describe("OutlineNav: the heading can take the focus", () => {
  it("gives the heading to the ref, so the screen can focus it after a delete", () => {
    const { headingRef } = renderNav();
    expect(headingRef.current).toBe(screen.getByRole("heading", { level: 2, name: "Outline" }));
  });

  it("can be focused by code, but is not a stop when tabbing", () => {
    const { headingRef } = renderNav(createRef(), buildTree([makeOutlineItem({ title: "Act" })]));
    const heading = screen.getByRole("heading", { level: 2, name: "Outline" });
    expect(heading).toHaveAttribute("tabindex", "-1");
    headingRef.current?.focus();
    expect(heading).toHaveFocus();
  });

  it("works without a ref", () => {
    render(
      <MemoryRouter>
        <OutlineNav nodes={[]} selectedId={undefined} onSelect={() => undefined} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Outline" })).toBeVisible();
  });

  it("has no accessibility violations with the focusable heading", async () => {
    const { container } = renderNav(createRef(), buildTree([makeOutlineItem({ title: "Act" })]));
    await expectNoA11yViolations(container);
  });
});
