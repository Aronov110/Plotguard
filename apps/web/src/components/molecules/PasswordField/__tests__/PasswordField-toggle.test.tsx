import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { PasswordField } from "../PasswordField.tsx";

function renderField(onSubmit: () => void = () => undefined) {
  return render(
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <PasswordField id="pw" label="Password" autoComplete="current-password" icon="lock" />
    </form>,
  );
}

const toggle = () => screen.getByRole("button", { name: "Show password" });

describe("PasswordField: the joined show-password button", () => {
  it("is an icon-only button that keeps the name Show password", () => {
    renderField();
    expect(toggle()).toHaveTextContent("Show password");
    expect(toggle().querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(toggle().querySelector(".visually-hidden")).toHaveTextContent("Show password");
  });

  it("carries its state in aria-pressed, not in a changed name", async () => {
    renderField();
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
    expect(toggle()).toHaveAccessibleName("Show password");
  });

  it("shows and hides what was typed, and shows the matching picture", async () => {
    renderField();
    const field = screen.getByLabelText("Password");
    expect(field).toHaveAttribute("type", "password");
    expect(toggle().querySelector("svg")).toHaveAttribute("data-icon", "eye");
    await userEvent.click(toggle());
    expect(field).toHaveAttribute("type", "text");
    expect(toggle().querySelector("svg")).toHaveAttribute("data-icon", "eye-off");
    await userEvent.click(toggle());
    expect(field).toHaveAttribute("type", "password");
  });

  it("does not change or lose what was typed when it is pressed", async () => {
    renderField();
    const field = screen.getByLabelText("Password");
    await userEvent.type(field, "  a b 😀 ");
    await userEvent.click(toggle());
    expect(field).toHaveValue("  a b 😀 ");
  });

  it("never submits the form", async () => {
    const onSubmit = vi.fn();
    renderField(onSubmit);
    await userEvent.click(toggle());
    toggle().focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("works from the keyboard: Tab from the field reaches it, Enter and Space press it", async () => {
    renderField();
    screen.getByLabelText("Password").focus();
    await userEvent.tab();
    expect(toggle()).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
    await userEvent.keyboard(" ");
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
  });

  it("is joined to the field and names it with aria-controls", () => {
    const { container } = renderField();
    const control = container.querySelector(".form-field__control");
    expect(control).toHaveAttribute("data-joined", "true");
    expect(toggle().getAttribute("aria-controls")).toBe("pw");
  });

  it("has no accessibility violations, hidden and shown", async () => {
    const { container } = renderField();
    await expectNoA11yViolations(container);
    await userEvent.click(toggle());
    await expectNoA11yViolations(container);
  });
});
