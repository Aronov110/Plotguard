import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { TextArea } from "../TextArea.tsx";

describe("TextArea", () => {
  it("is a multi-line text box with four rows by default", () => {
    render(<TextArea id="a" aria-label="A" />);
    const field = screen.getByRole("textbox", { name: "A" });
    expect(field.tagName).toBe("TEXTAREA");
    expect(field).toHaveAttribute("rows", "4");
  });

  it("takes another number of rows", () => {
    render(<TextArea id="a" aria-label="A" rows={8} />);
    expect(screen.getByLabelText("A")).toHaveAttribute("rows", "8");
  });

  it("is not marked invalid unless it is", () => {
    render(<TextArea id="a" aria-label="A" />);
    expect(screen.getByLabelText("A")).not.toHaveAttribute("aria-invalid");
  });

  it("tells assistive technology that the value is wrong", () => {
    render(<TextArea id="a" aria-label="A" invalid />);
    expect(screen.getByLabelText("A")).toBeInvalid();
    expect(screen.getByLabelText("A")).toHaveAttribute("aria-invalid", "true");
  });

  it("passes every textarea attribute through, including a ref", () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(
      <TextArea id="a" aria-label="A" name="logline" placeholder="One line" disabled ref={ref} />,
    );
    const field = screen.getByLabelText("A");
    expect(ref.current).toBe(field);
    expect(field).toHaveAttribute("name", "logline");
    expect(field).toHaveAttribute("placeholder", "One line");
    expect(field).toBeDisabled();
  });

  it("keeps what is typed, including line breaks", async () => {
    const user = userEvent.setup();
    render(<TextArea id="a" aria-label="A" />);
    await user.type(screen.getByLabelText("A"), "one{Enter}two");
    expect(screen.getByLabelText("A")).toHaveValue("one\ntwo");
  });

  it("has the class of its style", () => {
    render(<TextArea id="a" aria-label="A" />);
    expect(screen.getByLabelText("A")).toHaveClass("text-area");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <>
        <label htmlFor="a">A</label>
        <TextArea id="a" invalid />
      </>,
    );
    await expectNoA11yViolations(container);
  });
});
