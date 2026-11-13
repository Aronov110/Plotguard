import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { FormField } from "../FormField.tsx";

describe("FormField with an icon", () => {
  it("shows a decorative icon inside the field's box, hidden from screen readers", () => {
    const { container } = render(<FormField id="email" label="Email" icon="mail" />);
    const icon = container.querySelector(".form-field__icon svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveAttribute("data-icon", "mail");
  });

  it("does not add the icon to the name of the field", () => {
    render(<FormField id="email" label="Email" icon="mail" />);
    expect(screen.getByRole("textbox", { name: "Email" })).toBeInTheDocument();
  });

  it("has no icon unless asked for one", () => {
    const { container } = render(<FormField id="email" label="Email" />);
    expect(container.querySelector(".form-field__icon")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("marks the field as having an icon, so that the text keeps clear of it", () => {
    const { container } = render(<FormField id="email" label="Email" icon="mail" />);
    expect(container.querySelector(".form-field__box")).toHaveAttribute("data-icon", "true");
    const plain = render(<FormField id="b" label="B" />);
    expect(plain.container.querySelector(".form-field__box")).not.toHaveAttribute("data-icon");
  });

  it("clicking the icon focuses nothing odd: the label still focuses the field", async () => {
    render(<FormField id="email" label="Email" icon="mail" />);
    await userEvent.click(screen.getByText("Email"));
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveFocus();
  });

  it("works with a hint and an error at once, both tied to the field", () => {
    render(
      <FormField id="email" label="Email" icon="mail" hint="Your login." error="Enter an email." />,
    );
    const field = screen.getByRole("textbox", { name: "Email" });
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field.getAttribute("aria-describedby")).toBe("email-hint email-error");
  });

  it("puts an extra control after the field, in the same joined box", () => {
    const { container } = render(
      <FormField
        id="pw"
        label="Password"
        action={<button type="button">Do it</button>}
        icon="lock"
      />,
    );
    const control = container.querySelector(".form-field__control");
    expect(control?.children).toHaveLength(2);
    expect(control?.lastElementChild).toHaveTextContent("Do it");
    expect(control).toHaveAttribute("data-joined", "true");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <FormField id="email" label="Email" icon="mail" hint="Your login." error="Enter an email." />,
    );
    await expectNoA11yViolations(container);
  });
});
