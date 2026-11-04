import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { FormField } from "../FormField.tsx";

function ControlledField() {
  const [value, setValue] = useState("");
  return (
    <FormField
      id="a"
      label="A"
      value={value}
      onChange={(event) => {
        setValue(event.target.value);
      }}
    />
  );
}

describe("FormField", () => {
  it("connects the label to the field", () => {
    render(<FormField id="email" label="Email" />);
    const field = screen.getByLabelText("Email");
    expect(field).toBe(document.getElementById("email"));
    expect(field.tagName).toBe("INPUT");
  });

  it("marks an optional field in words", () => {
    render(<FormField id="name" label="Display name" optional />);
    expect(screen.getByRole("textbox", { name: "Display name (optional)" })).toBeInTheDocument();
  });

  it("has no description, and is not marked invalid, when there is no hint or error", () => {
    render(<FormField id="a" label="A" />);
    const field = screen.getByLabelText("A");
    expect(field).not.toHaveAttribute("aria-describedby");
    expect(field).not.toHaveAttribute("aria-invalid");
  });

  describe("hint", () => {
    it("is shown and read out as the field's description", () => {
      render(<FormField id="a" label="A" hint="12 to 128 characters." />);
      expect(screen.getByText("12 to 128 characters.")).toBeInTheDocument();
      expect(screen.getByLabelText("A")).toHaveAccessibleDescription("12 to 128 characters.");
      expect(screen.getByLabelText("A")).not.toHaveAttribute("aria-invalid");
    });

    it("has an id built from the field's id", () => {
      render(<FormField id="a" label="A" hint="Hint" />);
      expect(screen.getByText("Hint")).toHaveAttribute("id", "a-hint");
    });
  });

  describe("error", () => {
    it("is shown, read out as the description, and marks the field invalid", () => {
      render(<FormField id="a" label="A" error="Enter a valid email address." />);
      const field = screen.getByLabelText("A");
      expect(field).toBeInvalid();
      expect(field).toHaveAccessibleDescription("Error: Enter a valid email address.");
      expect(document.getElementById("a-error")).toHaveTextContent("Enter a valid email address.");
    });

    it("is read out after the hint when both exist", () => {
      render(<FormField id="a" label="A" hint="A hint." error="A problem." />);
      expect(screen.getByLabelText("A")).toHaveAccessibleDescription("A hint. Error: A problem.");
      expect(screen.getByLabelText("A")).toHaveAttribute("aria-describedby", "a-hint a-error");
    });

    it("counts as no error when it is empty", () => {
      render(<FormField id="a" label="A" error="" />);
      expect(screen.getByLabelText("A")).not.toHaveAttribute("aria-invalid");
      expect(document.getElementById("a-error")).toBeNull();
    });

    it("is shown as plain text, whatever it contains", () => {
      const { container } = render(
        <FormField id="a" label="A" error={'<img src=x onerror="alert(1)">'} />,
      );
      expect(container.querySelector("img")).toBeNull();
      expect(document.getElementById("a-error")).toHaveTextContent(
        '<img src=x onerror="alert(1)">',
      );
    });
  });

  it("passes input attributes on", () => {
    render(
      <FormField
        id="email"
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        spellCheck={false}
        autoCapitalize="none"
      />,
    );
    const field = screen.getByLabelText("Email");
    expect(field).toHaveAttribute("type", "email");
    expect(field).toHaveAttribute("name", "email");
    expect(field).toHaveAttribute("autocomplete", "email");
    expect(field).toHaveAttribute("inputmode", "email");
    expect(field).toHaveAttribute("spellcheck", "false");
  });

  it("works as a controlled field", async () => {
    render(<ControlledField />);
    await userEvent.setup().type(screen.getByLabelText("A"), " spaced 🔑 ");
    expect(screen.getByLabelText("A")).toHaveValue(" spaced 🔑 ");
  });

  it("hands the input to a ref, so a form can focus the first field with a problem", () => {
    const ref = createRef<HTMLInputElement>();
    render(<FormField id="a" label="A" ref={ref} />);
    expect(ref.current).toBe(screen.getByLabelText("A"));
  });

  it("shows an extra control next to the field", () => {
    render(<FormField id="a" label="A" action={<button type="button">Extra</button>} />);
    expect(screen.getByRole("button", { name: "Extra" })).toBeInTheDocument();
  });

  it("keeps two fields apart", () => {
    render(
      <>
        <FormField id="one" label="One" error="First problem." />
        <FormField id="two" label="Two" hint="Second hint." />
      </>,
    );
    expect(screen.getByLabelText("One")).toHaveAccessibleDescription("Error: First problem.");
    expect(screen.getByLabelText("Two")).toHaveAccessibleDescription("Second hint.");
  });

  it("has no accessibility violations in any state", async () => {
    const { container } = render(
      <div>
        <FormField id="a" label="Plain" />
        <FormField id="b" label="Hinted" hint="A hint." />
        <FormField id="c" label="Wrong" error="A problem." />
        <FormField id="d" label="Both" hint="A hint." error="A problem." optional />
      </div>,
    );
    await expectNoA11yViolations(container);
  });
});
