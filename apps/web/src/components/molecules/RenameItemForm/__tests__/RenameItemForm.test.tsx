import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ItemActionProblem } from "../../../../lib/documents/document-feedback.ts";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { RenameItemForm, type RenameItemFormProps } from "../RenameItemForm.tsx";

function renderForm(props: Partial<RenameItemFormProps> = {}) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const view = render(
    <RenameItemForm
      currentTitle="The Storm"
      busy={false}
      problem={undefined}
      onSave={onSave}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { ...view, onSave, onCancel, user: userEvent.setup() };
}

const problem = (title: string | undefined, ...general: string[]): ItemActionProblem => ({
  title,
  general,
});

describe("RenameItemForm", () => {
  it("is a form with a field for the new title that has the current one, and no landmark of its own", () => {
    const { container } = renderForm();
    expect(container.querySelector("form")).toBeVisible();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "New title" })).toHaveValue("The Storm");
  });

  it("opens with the focus in the field and the title selected, so that typing replaces it", async () => {
    const { user } = renderForm();
    const field = screen.getByRole("textbox", { name: "New title" });
    expect(field).toHaveFocus();
    expect(field).toHaveProperty("selectionStart", 0);
    expect(field).toHaveProperty("selectionEnd", "The Storm".length);
    await user.keyboard("Calm");
    expect(field).toHaveValue("Calm");
  });

  it("sends the title as typed when Save is pressed, and when Enter is pressed", async () => {
    const { user, onSave } = renderForm();
    await user.keyboard("  The Calm  ");
    await user.click(screen.getByRole("button", { name: "Save title" }));
    expect(onSave).toHaveBeenLastCalledWith("  The Calm  ");

    await user.type(screen.getByRole("textbox", { name: "New title" }), "!{Enter}");
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith("  The Calm  !");
  });

  it("sends an empty title too: the caller says what is wrong with it", async () => {
    const { user, onSave } = renderForm();
    await user.clear(screen.getByRole("textbox", { name: "New title" }));
    await user.click(screen.getByRole("button", { name: "Save title" }));
    expect(onSave).toHaveBeenCalledWith("");
  });

  it("keeps the title exactly as typed: emoji, right-to-left text and markup", async () => {
    const { user, onSave } = renderForm();
    await user.clear(screen.getByRole("textbox", { name: "New title" }));
    await user.paste("😀 שלום <b>x</b>");
    await user.click(screen.getByRole("button", { name: "Save title" }));
    expect(onSave).toHaveBeenCalledWith("😀 שלום <b>x</b>");
  });

  it("closes without sending anything when Cancel is pressed or Escape is pressed", async () => {
    const { user, onSave, onCancel } = renderForm();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("ignores other keys", async () => {
    const { user, onCancel, onSave } = renderForm();
    await user.keyboard("abc{ArrowLeft}{Tab}");
    expect(onCancel).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  describe("while the rename runs", () => {
    it("says so, shows Save as busy, and ignores presses on it", async () => {
      const { user, onSave } = renderForm({ busy: true });
      const save = screen.getByRole("button", { name: "Save title" });
      expect(save).toHaveAttribute("aria-busy", "true");
      expect(screen.getByRole("status")).toHaveTextContent("Renaming…");
      await user.click(save);
      expect(onSave).not.toHaveBeenCalled();
    });

    it("does not let Escape close what is already being sent", async () => {
      const { user, onCancel } = renderForm({ busy: true });
      await user.keyboard("{Escape}");
      expect(onCancel).not.toHaveBeenCalled();
    });
  });

  describe("when the rename failed", () => {
    it("lists a title problem as a link to the field, shows it under the field, and moves the focus to the list", () => {
      renderForm({ problem: problem("The title can be at most 200 characters.") });

      const alerts = screen.getAllByRole("alert");
      expect(alerts[0]).toHaveFocus();
      expect(alerts[0]).toHaveTextContent("The title can be at most 200 characters.");
      expect(
        screen.getByRole("link", { name: "The title can be at most 200 characters." }),
      ).toBeVisible();
      const field = screen.getByRole("textbox", { name: "New title" });
      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(field).toHaveAccessibleDescription(/The title can be at most 200 characters./);
    });

    it("lists a general problem as plain text, with no field marked wrong", () => {
      renderForm({
        problem: problem(undefined, "Can't reach the server. Check your connection and try again."),
      });
      expect(screen.getByRole("alert")).toHaveTextContent("Can't reach the server.");
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "New title" })).not.toHaveAttribute(
        "aria-invalid",
      );
    });

    it("keeps what was typed", async () => {
      const { user, rerender, onSave, onCancel } = renderForm();
      await user.keyboard("Typed title");
      rerender(
        <RenameItemForm
          currentTitle="The Storm"
          busy={false}
          problem={problem("No.")}
          onSave={onSave}
          onCancel={onCancel}
        />,
      );
      expect(screen.getByRole("textbox", { name: "New title" })).toHaveValue("Typed title");
    });

    it("moves the focus to the problems again for a new failure with the same words", () => {
      const { rerender, onSave, onCancel } = renderForm({ problem: problem(undefined, "Busy.") });
      screen.getByRole("textbox", { name: "New title" }).focus();
      rerender(
        <RenameItemForm
          currentTitle="The Storm"
          busy={false}
          problem={problem(undefined, "Busy.")}
          onSave={onSave}
          onCancel={onCancel}
        />,
      );
      expect(screen.getByRole("alert")).toHaveFocus();
    });

    it("shows nothing when there is no problem", () => {
      renderForm();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("shows the words as plain text, whatever they contain", () => {
      renderForm({ problem: problem(undefined, "<b>x</b>") });
      expect(screen.getByRole("alert")).toHaveTextContent("<b>x</b>");
      expect(document.querySelector("b")).toBeNull();
    });
  });

  it("shows a current title with markup in it as text", () => {
    renderForm({ currentTitle: "<script>alert(1)</script>" });
    expect(screen.getByRole("textbox", { name: "New title" })).toHaveValue(
      "<script>alert(1)</script>",
    );
    expect(document.querySelector("script")).toBeNull();
  });

  it("has no accessibility violations: plain, busy, and with each kind of problem", async () => {
    const { container } = render(
      <>
        <RenameItemForm
          currentTitle="A"
          busy={false}
          problem={undefined}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />
        <RenameItemForm
          currentTitle="B"
          busy
          problem={undefined}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />
        <RenameItemForm
          currentTitle="C"
          busy={false}
          problem={problem("Enter a title.")}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />
        <RenameItemForm
          currentTitle="D"
          busy={false}
          problem={problem(undefined, "Busy.")}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />
      </>,
    );
    await expectNoA11yViolations(container);
  });
});
