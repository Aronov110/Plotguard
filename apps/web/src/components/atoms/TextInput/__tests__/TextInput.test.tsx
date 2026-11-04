import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { TextInput } from "../TextInput.tsx";

function ControlledInput() {
  const [value, setValue] = useState("");
  return (
    <TextInput
      id="a"
      aria-label="A"
      value={value}
      onChange={(event) => {
        setValue(event.target.value);
      }}
    />
  );
}

describe("TextInput", () => {
  it("is a text box with the given id", () => {
    render(<TextInput id="name" aria-label="Name" />);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveAttribute("id", "name");
  });

  it("is a plain text field unless told otherwise", () => {
    render(<TextInput id="name" aria-label="Name" />);
    expect(screen.getByRole("textbox")).toHaveAttribute("type", "text");
  });

  it("passes the usual attributes on", () => {
    render(
      <TextInput
        id="email"
        aria-label="Email"
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        spellCheck={false}
        autoCapitalize="none"
        required
        maxLength={50}
      />,
    );
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("type", "email");
    expect(input).toHaveAttribute("name", "email");
    expect(input).toHaveAttribute("autocomplete", "email");
    expect(input).toHaveAttribute("inputmode", "email");
    expect(input).toHaveAttribute("spellcheck", "false");
    expect(input).toHaveAttribute("autocapitalize", "none");
    expect(input).toBeRequired();
    expect(input).toHaveAttribute("maxlength", "50");
  });

  describe("invalid", () => {
    it("tells assistive technology when the value is wrong", () => {
      render(<TextInput id="a" aria-label="A" invalid />);
      expect(screen.getByRole("textbox")).toBeInvalid();
      expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
    });

    it("says nothing about validity when the value is fine", () => {
      render(<TextInput id="a" aria-label="A" />);
      expect(screen.getByRole("textbox")).not.toHaveAttribute("aria-invalid");
    });
  });

  it("links to the text that describes it", () => {
    render(
      <div>
        <TextInput id="a" aria-label="A" aria-describedby="hint error" />
        <p id="hint">A hint</p>
        <p id="error">An error</p>
      </div>,
    );
    expect(screen.getByRole("textbox")).toHaveAccessibleDescription("A hint An error");
  });

  it("works as a controlled field and keeps every character as typed", async () => {
    render(<ControlledInput />);
    const typed = "  pä ss🔑 wörd  ";
    await userEvent.setup().type(screen.getByRole("textbox"), typed);
    expect(screen.getByRole("textbox")).toHaveValue(typed);
  });

  it("calls onChange for every edit", async () => {
    const onChange = vi.fn();
    render(<TextInput id="a" aria-label="A" onChange={onChange} />);
    await userEvent.setup().type(screen.getByRole("textbox"), "abc");
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("allows pasting", async () => {
    render(<TextInput id="a" aria-label="A" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("textbox"));
    await user.paste("pasted value");
    expect(screen.getByRole("textbox")).toHaveValue("pasted value");
  });

  it("hands the real input element to a ref, so a form can focus it", () => {
    const ref = createRef<HTMLInputElement>();
    render(<TextInput id="a" aria-label="A" ref={ref} />);
    expect(ref.current).toBe(screen.getByRole("textbox"));
    ref.current?.focus();
    expect(screen.getByRole("textbox")).toHaveFocus();
  });

  it("can be disabled and read-only", () => {
    render(
      <div>
        <TextInput id="a" aria-label="Off" disabled />
        <TextInput id="b" aria-label="Read" readOnly />
      </div>,
    );
    expect(screen.getByLabelText("Off")).toBeDisabled();
    expect(screen.getByLabelText("Read")).toHaveAttribute("readonly");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <div>
        <label htmlFor="a">A</label>
        <TextInput id="a" />
        <label htmlFor="b">B</label>
        <TextInput id="b" invalid aria-describedby="e" />
        <p id="e">Problem</p>
      </div>,
    );
    await expectNoA11yViolations(container);
  });
});
