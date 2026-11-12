import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { DeleteConfirmation, type DeleteConfirmationProps } from "../DeleteConfirmation.tsx";

function renderConfirmation(props: Partial<DeleteConfirmationProps> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const view = render(
    <DeleteConfirmation
      title="The Lighthouse"
      noun="project"
      consequence="Its documents and analyses are deleted too, and this cannot be undone."
      busy={false}
      error={undefined}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { ...view, onConfirm, onCancel, user: userEvent.setup() };
}

describe("DeleteConfirmation", () => {
  it("is a group named by its question, which names the project", () => {
    renderConfirmation();
    expect(screen.getByRole("group", { name: "Delete “The Lighthouse”?" })).toBeVisible();
  });

  it("says what will be lost and that it cannot be undone", () => {
    renderConfirmation();
    expect(screen.getByRole("group")).toHaveTextContent(
      "Its documents and analyses are deleted too, and this cannot be undone.",
    );
  });

  it("has a delete button and a keep button, with words that say what they do", () => {
    renderConfirmation();
    expect(screen.getByRole("button", { name: "Delete project" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Keep project" })).toBeVisible();
  });

  it("is a danger button that deletes, and a plain one that keeps", () => {
    renderConfirmation();
    expect(screen.getByRole("button", { name: "Delete project" })).toHaveClass("button--danger");
    expect(screen.getByRole("button", { name: "Keep project" })).toHaveClass("button--secondary");
  });

  it("calls onConfirm for the delete button and onCancel for the keep button", async () => {
    const { user, onConfirm, onCancel } = renderConfirmation();
    await user.click(screen.getByRole("button", { name: "Keep project" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete project" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("keeps the project when Escape is pressed on either button", async () => {
    const { user, onConfirm, onCancel } = renderConfirmation();
    screen.getByRole("button", { name: "Delete project" }).focus();
    await user.keyboard("{Escape}");
    screen.getByRole("button", { name: "Keep project" }).focus();
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("ignores other keys", async () => {
    const { user, onCancel, onConfirm } = renderConfirmation();
    screen.getByRole("button", { name: "Keep project" }).focus();
    await user.keyboard("{ArrowDown}a{Tab}");
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("gives the keep button a ref, so the question can open with the focus there", () => {
    const keepRef = createRef<HTMLButtonElement>();
    renderConfirmation({ keepRef });
    expect(keepRef.current).toBe(screen.getByRole("button", { name: "Keep project" }));
  });

  describe("while the delete runs", () => {
    it("says so, shows the delete button as busy and ignores presses on it", async () => {
      const { user, onConfirm } = renderConfirmation({ busy: true });
      const button = screen.getByRole("button", { name: "Delete project" });
      expect(button).toHaveAttribute("aria-busy", "true");
      expect(screen.getByRole("status")).toHaveTextContent("Deleting the project…");
      await user.click(button);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it("does not let Escape cancel what is already being deleted", async () => {
      const { user, onCancel } = renderConfirmation({ busy: true });
      screen.getByRole("button", { name: "Keep project" }).focus();
      await user.keyboard("{Escape}");
      expect(onCancel).not.toHaveBeenCalled();
    });
  });

  describe("when the delete failed", () => {
    it("shows why, as an alert, and keeps both buttons", () => {
      renderConfirmation({ error: "The service is busy. Try again in a moment." });
      expect(screen.getByRole("alert")).toHaveTextContent("The service is busy.");
      expect(screen.getByRole("button", { name: "Delete project" })).toBeVisible();
      expect(screen.getByRole("button", { name: "Keep project" })).toBeVisible();
    });

    it("shows nothing when there is no error", () => {
      renderConfirmation();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("shows the error as plain text", () => {
      renderConfirmation({ error: "<b>x</b>" });
      expect(screen.getByRole("alert")).toHaveTextContent("<b>x</b>");
      expect(document.querySelector("b")).toBeNull();
    });
  });

  it("shows the project's title as plain text, whatever it contains", () => {
    renderConfirmation({ title: "<script>alert(1)</script>" });
    expect(screen.getByRole("group")).toHaveTextContent("Delete “<script>alert(1)</script>”?");
    expect(document.querySelector("script")).toBeNull();
  });

  it("has no accessibility violations: plain, busy, and with an error", async () => {
    const { container } = render(
      <>
        <DeleteConfirmation
          title="A"
          noun="project"
          consequence="Gone for good."
          busy={false}
          error={undefined}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
        <DeleteConfirmation
          title="B"
          noun="project"
          consequence="Gone for good."
          busy
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
          error={undefined}
        />
        <DeleteConfirmation
          title="C"
          noun="project"
          consequence="Gone for good."
          busy={false}
          error="A problem."
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      </>,
    );
    await expectNoA11yViolations(container);
  });
});
