import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { TextAreaField } from "../TextAreaField.tsx";

describe("TextAreaField", () => {
  it("connects the label to the field", () => {
    render(<TextAreaField id="logline" label="Logline" />);
    const field = screen.getByLabelText("Logline");
    expect(field).toBe(document.getElementById("logline"));
    expect(field.tagName).toBe("TEXTAREA");
  });

  it("marks an optional field in words", () => {
    render(<TextAreaField id="logline" label="Logline" optional />);
    expect(screen.getByRole("textbox", { name: "Logline (optional)" })).toBeInTheDocument();
  });

  it("has no description, and is not marked invalid, when there is no hint or error", () => {
    render(<TextAreaField id="a" label="A" />);
    const field = screen.getByLabelText("A");
    expect(field).not.toHaveAttribute("aria-describedby");
    expect(field).not.toHaveAttribute("aria-invalid");
  });

  it("reads the hint out as the field's description", () => {
    render(<TextAreaField id="a" label="A" hint="One or two sentences." />);
    expect(screen.getByText("One or two sentences.")).toBeInTheDocument();
    expect(screen.getByLabelText("A")).toHaveAccessibleDescription("One or two sentences.");
    expect(screen.getByLabelText("A")).not.toHaveAttribute("aria-invalid");
  });

  it("shows the error, ties it to the field and marks the field invalid", () => {
    render(<TextAreaField id="a" label="A" error="The logline is too long." />);
    const field = screen.getByLabelText("A");
    expect(field).toBeInvalid();
    expect(field).toHaveAccessibleDescription("Error: The logline is too long.");
    expect(document.getElementById("a-error")).toHaveTextContent("The logline is too long.");
  });

  it("reads the hint and then the error", () => {
    render(<TextAreaField id="a" label="A" hint="A hint." error="An error." />);
    expect(screen.getByLabelText("A")).toHaveAttribute("aria-describedby", "a-hint a-error");
    expect(screen.getByLabelText("A")).toHaveAccessibleDescription("A hint. Error: An error.");
  });

  it("treats an empty error as no error", () => {
    render(<TextAreaField id="a" label="A" error="" />);
    expect(screen.getByLabelText("A")).not.toHaveAttribute("aria-invalid");
    expect(document.getElementById("a-error")).toBeNull();
  });

  it("shows an error as plain text, whatever it contains", () => {
    render(<TextAreaField id="a" label="A" error="<b>bold</b><script>x()</script>" />);
    expect(screen.getByText(/<b>bold<\/b>/)).toBeInTheDocument();
    expect(document.querySelector("b, script")).toBeNull();
  });

  it("passes the textarea attributes and the ref through", async () => {
    const ref = createRef<HTMLTextAreaElement>();
    const user = userEvent.setup();
    render(<TextAreaField id="a" label="A" name="logline" rows={6} ref={ref} />);
    const field = screen.getByLabelText("A");
    expect(ref.current).toBe(field);
    expect(field).toHaveAttribute("name", "logline");
    expect(field).toHaveAttribute("rows", "6");
    await user.type(field, "text");
    expect(field).toHaveValue("text");
  });

  it("has no accessibility violations, with a hint and with an error", async () => {
    const { container } = render(
      <>
        <TextAreaField id="a" label="A" hint="A hint." />
        <TextAreaField id="b" label="B" optional error="An error." />
      </>,
    );
    await expectNoA11yViolations(container);
  });
});
