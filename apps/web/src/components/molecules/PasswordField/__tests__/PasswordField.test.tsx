import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { PasswordField } from "../PasswordField.tsx";

function ControlledPasswordField() {
  const [value, setValue] = useState("");
  return (
    <PasswordField
      id="password"
      label="Password"
      autoComplete="new-password"
      value={value}
      onChange={(event) => {
        setValue(event.target.value);
      }}
    />
  );
}

describe("PasswordField", () => {
  it("hides the password by default", () => {
    render(<PasswordField id="password" label="Password" autoComplete="current-password" />);
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("asks the browser for the right kind of help with the password", () => {
    const { rerender } = render(
      <PasswordField id="password" label="Password" autoComplete="current-password" />,
    );
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
    rerender(<PasswordField id="password" label="Password" autoComplete="new-password" />);
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
  });

  it("keeps spell checking, capitals and autocorrect off, hidden or shown", async () => {
    const user = userEvent.setup();
    render(<PasswordField id="password" label="Password" autoComplete="current-password" />);
    const field = screen.getByLabelText("Password");
    const expectOff = (): void => {
      expect(field).toHaveAttribute("spellcheck", "false");
      expect(field).toHaveAttribute("autocapitalize", "none");
      expect(field).toHaveAttribute("autocorrect", "off");
    };

    expectOff();
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(field).toHaveAttribute("type", "text");
    expectOff();
  });

  describe("show password button", () => {
    it("starts unpressed and points to the field", () => {
      render(<PasswordField id="password" label="Password" autoComplete="current-password" />);
      const toggle = screen.getByRole("button", { name: "Show password" });
      expect(toggle).toHaveAttribute("aria-pressed", "false");
      expect(toggle).toHaveAttribute("aria-controls", "password");
      expect(toggle).toHaveAttribute("type", "button");
    });

    it("shows the password when pressed and hides it again when pressed again", async () => {
      const user = userEvent.setup();
      render(<PasswordField id="password" label="Password" autoComplete="current-password" />);
      const toggle = screen.getByRole("button", { name: "Show password" });

      await user.click(toggle);
      expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
      expect(toggle).toHaveAttribute("aria-pressed", "true");

      await user.click(toggle);
      expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
      expect(toggle).toHaveAttribute("aria-pressed", "false");
    });

    it("keeps its name, so a screen reader hears the state from aria-pressed alone", async () => {
      const user = userEvent.setup();
      render(<PasswordField id="password" label="Password" autoComplete="current-password" />);
      await user.click(screen.getByRole("button", { name: "Show password" }));
      expect(screen.getByRole("button", { name: "Show password" })).toBeInTheDocument();
    });

    it("works from the keyboard and keeps the focus on itself", async () => {
      const user = userEvent.setup();
      render(<PasswordField id="password" label="Password" autoComplete="current-password" />);
      await user.tab();
      expect(screen.getByLabelText("Password")).toHaveFocus();
      await user.tab();
      const toggle = screen.getByRole("button", { name: "Show password" });
      expect(toggle).toHaveFocus();

      await user.keyboard("{Enter}");
      expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
      expect(toggle).toHaveFocus();

      await user.keyboard(" ");
      expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
      expect(toggle).toHaveFocus();
    });

    it("does not submit the form it sits in", async () => {
      const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
      render(
        <form onSubmit={onSubmit}>
          <PasswordField id="password" label="Password" autoComplete="current-password" />
        </form>,
      );
      await userEvent.setup().click(screen.getByRole("button", { name: "Show password" }));
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  it("keeps the value untouched when it is shown and hidden", async () => {
    const user = userEvent.setup();
    const secret = "  pä ss 🔑 wörd  ";
    render(<ControlledPasswordField />);
    await user.type(screen.getByLabelText("Password"), secret);
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password")).toHaveValue(secret);
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password")).toHaveValue(secret);
  });

  it("allows pasting, so password managers and long passwords work", async () => {
    const user = userEvent.setup();
    render(<PasswordField id="password" label="Password" autoComplete="current-password" />);
    await user.click(screen.getByLabelText("Password"));
    await user.paste("correct horse battery staple");
    expect(screen.getByLabelText("Password")).toHaveValue("correct horse battery staple");
  });

  it("shows a hint and an error like any other field", () => {
    render(
      <PasswordField
        id="password"
        label="Password"
        autoComplete="new-password"
        hint="12 to 128 characters."
        error="Use at least 12 characters."
      />,
    );
    const field = screen.getByLabelText("Password");
    expect(field).toBeInvalid();
    expect(field).toHaveAccessibleDescription(
      "12 to 128 characters. Error: Use at least 12 characters.",
    );
  });

  it("hands the input to a ref", () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <PasswordField id="password" label="Password" autoComplete="current-password" ref={ref} />,
    );
    expect(ref.current).toBe(screen.getByLabelText("Password"));
  });

  it("has no accessibility violations, shown or hidden, with or without an error", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <div>
        <PasswordField id="one" label="Password" autoComplete="current-password" />
        <PasswordField
          id="two"
          label="New password"
          autoComplete="new-password"
          hint="A hint."
          error="A problem."
        />
      </div>,
    );
    await expectNoA11yViolations(container);
    await user.click(screen.getAllByRole("button", { name: "Show password" })[0] as HTMLElement);
    await expectNoA11yViolations(container);
  });
});
