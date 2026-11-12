import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { DeleteConfirmation } from "../DeleteConfirmation.tsx";

function renderFor(noun: string, consequence: string, busy = false) {
  return render(
    <DeleteConfirmation
      title="Scene 4"
      noun={noun}
      consequence={consequence}
      busy={busy}
      error={undefined}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
}

describe("DeleteConfirmation: the words come from what is deleted", () => {
  it("puts the noun in both buttons", () => {
    renderFor("item", "Its text is deleted too, and this cannot be undone.");
    expect(screen.getByRole("button", { name: "Delete item" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Keep item" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /project/ })).not.toBeInTheDocument();
  });

  it("puts the noun in the status while the delete runs", () => {
    renderFor("item", "Gone.", true);
    expect(screen.getByRole("status")).toHaveTextContent("Deleting the item…");
  });

  it("says the consequence as it was given, after the question that names the title", () => {
    renderFor(
      "item",
      "Its 3 scenes and all of their text are deleted too, and this cannot be undone.",
    );
    const group = screen.getByRole("group", { name: "Delete “Scene 4”?" });
    expect(group).toHaveTextContent(
      "Delete “Scene 4”? Its 3 scenes and all of their text are deleted too, and this cannot be undone.",
    );
  });

  it("shows a consequence with markup in it as plain text", () => {
    renderFor("item", "<b>All</b> of it.");
    expect(screen.getByRole("group")).toHaveTextContent("<b>All</b> of it.");
    expect(document.querySelector("b")).toBeNull();
  });

  it("has no accessibility violations with another noun", async () => {
    const { container } = renderFor("item", "Gone for good.");
    await expectNoA11yViolations(container);
  });
});
