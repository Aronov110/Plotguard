import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { InlineError } from "../InlineError.tsx";

describe("InlineError", () => {
  it("shows the message with the given id, so a field can point to it", () => {
    const { container } = render(<InlineError id="email-error">Enter a valid email.</InlineError>);
    expect(container.querySelector("#email-error")).toHaveTextContent("Enter a valid email.");
  });

  it("says it is an error in words, not only with color or an icon", () => {
    const { container } = render(<InlineError id="e">Too short.</InlineError>);
    expect(container.querySelector("#e")).toHaveTextContent("Error: Too short.");
  });

  it("hides the decorative icon from screen readers", () => {
    const { container } = render(<InlineError id="e">Too short.</InlineError>);
    expect(container.querySelector("[aria-hidden='true']")).toBeInTheDocument();
    expect(screen.getByText("Error:")).toHaveClass("visually-hidden");
  });

  it("draws its picture as an icon, not as a text symbol", () => {
    const { container } = render(<InlineError id="e">Too short.</InlineError>);
    expect(container.querySelector(".inline-error__icon svg")).toHaveAttribute(
      "data-icon",
      "alert",
    );
    expect(container).not.toHaveTextContent("⚠");
  });

  it("is a paragraph of plain text", () => {
    const { container } = render(<InlineError id="e">Too short.</InlineError>);
    expect(container.querySelector("p#e")).toBeInTheDocument();
  });

  it("shows markup in the message as plain text and never as HTML", () => {
    const { container } = render(
      <InlineError id="e">{'<img src=x onerror="alert(1)"> & <b>bold</b>'}</InlineError>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("#e")).toHaveTextContent(
      'Error: <img src=x onerror="alert(1)"> & <b>bold</b>',
    );
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <div>
        <label htmlFor="a">A</label>
        <input id="a" aria-invalid="true" aria-describedby="a-error" />
        <InlineError id="a-error">Problem.</InlineError>
      </div>,
    );
    await expectNoA11yViolations(container);
  });
});
