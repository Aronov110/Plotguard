import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { FocusField } from "../FocusField.tsx";

function Harness({ initial = "", disabled = false }: { initial?: string; disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  return <FocusField id="focus" value={value} onChange={setValue} disabled={disabled} />;
}

describe("FocusField", () => {
  it("is a labelled field that says it is optional", () => {
    render(<Harness />);
    const field = screen.getByRole("textbox", { name: /What should the ideas be about\?/ });
    expect(field).toBeInTheDocument();
    expect(screen.getByText(/optional/i)).toBeInTheDocument();
  });

  it("gives an example, tells that line breaks become spaces, and counts, in the hint", () => {
    render(<Harness />);
    const field = screen.getByRole("textbox");
    const hint = document.getElementById(field.getAttribute("aria-describedby") ?? "");
    expect(hint).toHaveTextContent("For example:");
    expect(hint).toHaveTextContent("Line breaks become spaces.");
    expect(hint).toHaveTextContent("0 of 500 characters.");
  });

  it("counts what the server counts: tidied spaces, an emoji as one", async () => {
    render(<Harness />);
    await userEvent.type(screen.getByRole("textbox"), "  ab  {Enter}{Enter}c ");
    expect(screen.getByText(/of 500 characters/)).toHaveTextContent("4 of 500 characters.");
    await userEvent.type(screen.getByRole("textbox"), "\u{1F600}");
    // "ab c" and then a space and the emoji: "ab c 😀" is six characters, the emoji counting as one.
    expect(screen.getByText(/of 500 characters/)).toHaveTextContent("6 of 500 characters.");
  });

  it("passes what is typed on", async () => {
    const onChange = vi.fn();
    render(<FocusField id="f" value="" onChange={onChange} disabled={false} />);
    await userEvent.type(screen.getByRole("textbox"), "a");
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("shows no error at exactly 500 characters", () => {
    render(<Harness initial={"a".repeat(500)} />);
    expect(screen.getByRole("textbox")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText(/too long/)).not.toBeInTheDocument();
    expect(screen.getByText(/of 500 characters/)).toHaveTextContent("500 of 500 characters.");
  });

  it("shows an error tied to the field at 501, in the singular", () => {
    render(<Harness initial={"a".repeat(501)} />);
    const field = screen.getByRole("textbox");
    expect(field).toHaveAttribute("aria-invalid", "true");
    const error = screen.getByText(/1 character too long/);
    expect(error).toHaveTextContent("It can be at most 500.");
    expect(field.getAttribute("aria-describedby")).toContain(error.id);
  });

  it("says how many characters too many, in the plural", () => {
    render(<Harness initial={"a".repeat(512)} />);
    expect(screen.getByText(/12 characters too long/)).toBeInTheDocument();
  });

  it("does not count the spaces that cleaning removes towards the limit", () => {
    render(<Harness initial={`${"a".repeat(500)}${" \n ".repeat(20)}`} />);
    expect(screen.queryByText(/too long/)).not.toBeInTheDocument();
  });

  it("says once, in a status, that the focus is too long, and nothing before", async () => {
    render(<Harness initial={"a".repeat(500)} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("");
    await userEvent.type(screen.getByRole("textbox"), "b");
    expect(status).toHaveTextContent("The focus is too long.");
    await userEvent.type(screen.getByRole("textbox"), "c");
    expect(status).toHaveTextContent(/^The focus is too long\.$/);
  });

  it("stops taking text far above the limit, so that a huge paste cannot fill the page", () => {
    render(<Harness />);
    expect(screen.getByRole("textbox")).toHaveAttribute("maxlength", "2000");
  });

  it("cannot be changed while a run goes, and still shows its text", () => {
    render(<Harness initial="a stronger ending" disabled />);
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("textbox")).toHaveValue("a stronger ending");
  });

  it("has no accessibility violations, with and without an error", async () => {
    const { container, unmount } = render(<Harness />);
    await expectNoA11yViolations(container);
    unmount();
    const over = render(<Harness initial={"a".repeat(501)} />);
    await expectNoA11yViolations(over.container);
  });
});
