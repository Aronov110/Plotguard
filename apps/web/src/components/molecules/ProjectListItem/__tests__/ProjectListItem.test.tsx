import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { ProjectListItem, projectItemId } from "../ProjectListItem.tsx";

function renderItem() {
  return render(
    <ul>
      <ProjectListItem projectId="abc">
        <p>What the card shows</p>
      </ProjectListItem>
    </ul>,
  );
}

describe("ProjectListItem", () => {
  it("is a list item that holds what it is given", () => {
    renderItem();
    const item = screen.getByRole("listitem");
    expect(item).toHaveTextContent("What the card shows");
    expect(item.tagName).toBe("LI");
  });

  it("has an id built from the project's id, so the list can find it", () => {
    renderItem();
    expect(screen.getByRole("listitem")).toHaveAttribute("id", "project-abc");
  });

  it("can be focused by code, but is not in the tab order", () => {
    renderItem();
    const item = screen.getByRole("listitem");
    expect(item).toHaveAttribute("tabindex", "-1");
    item.focus();
    expect(item).toHaveFocus();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderItem();
    await expectNoA11yViolations(container);
  });
});

describe("projectItemId", () => {
  it("builds the id from the project's id", () => {
    expect(projectItemId("abc")).toBe("project-abc");
  });
});
