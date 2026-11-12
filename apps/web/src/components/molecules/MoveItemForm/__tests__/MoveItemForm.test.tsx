import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ItemActionProblem } from "../../../../lib/documents/document-feedback.ts";
import type { Destination } from "../../../../lib/documents/item-moves.ts";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { MoveItemForm, type MoveItemFormProps } from "../MoveItemForm.tsx";

const destinations: readonly Destination[] = [
  { value: "top", parentId: null, label: "Top level" },
  { value: "act-2", parentId: "act-2", label: "Inside “Act 2”" },
  { value: "act-3", parentId: "act-3", label: "Inside “Act 3”" },
];

function renderForm(props: Partial<MoveItemFormProps> = {}) {
  const onMove = vi.fn();
  const onCancel = vi.fn();
  const view = render(
    <MoveItemForm
      destinations={destinations}
      busy={false}
      problem={undefined}
      onMove={onMove}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { ...view, onMove, onCancel, user: userEvent.setup() };
}

const problem = (...general: string[]): ItemActionProblem => ({ title: undefined, general });

describe("MoveItemForm", () => {
  it("has a list named Move to, with every place it was given, in order", () => {
    renderForm();
    expect(screen.getByRole("combobox", { name: "Move to" })).toBeVisible();
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Top level",
      "Inside “Act 2”",
      "Inside “Act 3”",
    ]);
  });

  it("opens with the focus on the list", () => {
    renderForm();
    expect(screen.getByRole("combobox", { name: "Move to" })).toHaveFocus();
  });

  it("says that the item goes to the end, and how to place it exactly", () => {
    renderForm();
    expect(screen.getByText(/goes to the end of the place you choose/)).toBeVisible();
    expect(screen.getByText(/Move up and Move down/)).toBeVisible();
  });

  it("moves to the first place when nothing else was chosen", async () => {
    const { user, onMove } = renderForm();
    await user.click(screen.getByRole("button", { name: "Move" }));
    expect(onMove).toHaveBeenCalledWith(null);
  });

  it("moves to the act that was chosen, giving its id", async () => {
    const { user, onMove } = renderForm();
    await user.selectOptions(screen.getByRole("combobox", { name: "Move to" }), "act-3");
    await user.click(screen.getByRole("button", { name: "Move" }));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith("act-3");
  });

  it("moves with the keyboard alone: choose a place, Tab to Move, press Enter", async () => {
    const { user, onMove } = renderForm();
    await user.selectOptions(screen.getByRole("combobox", { name: "Move to" }), "act-2");
    await user.tab();
    expect(screen.getByRole("button", { name: "Move" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith("act-2");
  });

  it("sends the top level as null, never as the word top", async () => {
    const { user, onMove } = renderForm();
    await user.selectOptions(screen.getByRole("combobox", { name: "Move to" }), "top");
    await user.click(screen.getByRole("button", { name: "Move" }));
    expect(onMove).toHaveBeenCalledWith(null);
  });

  it("closes without moving when Cancel is pressed or Escape is pressed", async () => {
    const { user, onMove, onCancel } = renderForm();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("does nothing when there is nowhere to go", async () => {
    const { user, onMove } = renderForm({ destinations: [] });
    await user.click(screen.getByRole("button", { name: "Move" }));
    expect(onMove).not.toHaveBeenCalled();
  });

  describe("while the move runs", () => {
    it("says so, shows Move as busy, and ignores presses on it", async () => {
      const { user, onMove } = renderForm({ busy: true });
      const button = screen.getByRole("button", { name: "Move" });
      expect(button).toHaveAttribute("aria-busy", "true");
      expect(screen.getByRole("status")).toHaveTextContent("Moving…");
      await user.click(button);
      expect(onMove).not.toHaveBeenCalled();
    });

    it("does not let Escape close what is already being sent", async () => {
      const { user, onCancel } = renderForm({ busy: true });
      await user.keyboard("{Escape}");
      expect(onCancel).not.toHaveBeenCalled();
    });
  });

  describe("when the move failed", () => {
    it("shows why, as an alert that takes the focus", () => {
      renderForm({
        problem: problem("That is not possible here. Check the outline and try again."),
      });
      const alert = screen.getByRole("alert");
      expect(alert).toHaveFocus();
      expect(alert).toHaveTextContent("That is not possible here.");
    });

    it("keeps the choice that was made", async () => {
      const { user, rerender, onMove, onCancel } = renderForm();
      await user.selectOptions(screen.getByRole("combobox", { name: "Move to" }), "act-3");
      rerender(
        <MoveItemForm
          destinations={destinations}
          busy={false}
          problem={problem("Busy.")}
          onMove={onMove}
          onCancel={onCancel}
        />,
      );
      expect(screen.getByRole("combobox", { name: "Move to" })).toHaveValue("act-3");
    });

    it("moves the focus to the problem again for a new failure with the same words", () => {
      const { rerender, onMove, onCancel } = renderForm({ problem: problem("Busy.") });
      screen.getByRole("combobox", { name: "Move to" }).focus();
      rerender(
        <MoveItemForm
          destinations={destinations}
          busy={false}
          problem={problem("Busy.")}
          onMove={onMove}
          onCancel={onCancel}
        />,
      );
      expect(screen.getByRole("alert")).toHaveFocus();
    });

    it("shows nothing when there is no problem", () => {
      renderForm();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("shows the words as plain text", () => {
      renderForm({ problem: problem("<b>x</b>") });
      expect(screen.getByRole("alert")).toHaveTextContent("<b>x</b>");
      expect(document.querySelector("b")).toBeNull();
    });
  });

  it("shows the title of an act as text, whatever it contains", () => {
    renderForm({
      destinations: [{ value: "x", parentId: "x", label: "Inside “<script>alert(1)</script>”" }],
    });
    expect(screen.getByRole("option")).toHaveTextContent("Inside “<script>alert(1)</script>”");
    expect(document.querySelector("script")).toBeNull();
  });

  it("has no accessibility violations: plain, busy and with a problem", async () => {
    const { container } = render(
      <>
        <MoveItemForm
          destinations={destinations}
          busy={false}
          problem={undefined}
          onMove={vi.fn()}
          onCancel={vi.fn()}
        />
        <MoveItemForm
          destinations={destinations}
          busy
          problem={undefined}
          onMove={vi.fn()}
          onCancel={vi.fn()}
        />
        <MoveItemForm
          destinations={destinations}
          busy={false}
          problem={problem("Busy.")}
          onMove={vi.fn()}
          onCancel={vi.fn()}
        />
      </>,
    );
    await expectNoA11yViolations(container);
  });
});
