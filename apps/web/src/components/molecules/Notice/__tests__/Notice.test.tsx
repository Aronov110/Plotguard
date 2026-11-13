import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { Notice } from "../Notice.tsx";

describe("Notice", () => {
  it("is announced politely when it appears", () => {
    render(<Notice>Saved.</Notice>);
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
  });

  it("is a warning unless it is information", () => {
    const { unmount } = render(<Notice>One</Notice>);
    expect(screen.getByRole("status")).toHaveClass("notice", "notice--warning");
    unmount();
    render(<Notice tone="info">One</Notice>);
    expect(screen.getByRole("status")).toHaveClass("notice--info");
    expect(screen.getByRole("status")).not.toHaveClass("notice--warning");
  });

  it("can hold other elements, such as a button", () => {
    render(
      <Notice>
        Could not sign out. <button type="button">Try again</button>
      </Notice>,
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <div>
        <Notice>Warning</Notice>
        <Notice tone="info">Info</Notice>
      </div>,
    );
    await expectNoA11yViolations(container);
  });

  it("shows a picture beside its words, hidden from screen readers and not part of what is read", () => {
    const { container } = render(<Notice>Something to know.</Notice>);
    const icon = container.querySelector(".notice__icon svg");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("status")).toHaveTextContent(/^Something to know\.$/);
  });

  it("keeps a button or a link that it is given", () => {
    render(
      <Notice tone="info">
        <p>Text.</p>
        <button type="button">Do it</button>
      </Notice>,
    );
    expect(screen.getByRole("button", { name: "Do it" })).toBeInTheDocument();
  });
});
