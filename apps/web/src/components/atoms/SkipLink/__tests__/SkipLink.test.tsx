import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { SkipLink } from "../SkipLink.tsx";

function Page() {
  return (
    <>
      <SkipLink targetId="main-content">Skip to main content</SkipLink>
      <header>
        <a href="/elsewhere">Header link</a>
      </header>
      <main id="main-content" tabIndex={-1}>
        <h1>Title</h1>
      </main>
    </>
  );
}

describe("SkipLink", () => {
  it("is a link to the content", () => {
    render(<Page />);
    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute(
      "href",
      "#main-content",
    );
  });

  it("is the first thing the keyboard reaches", async () => {
    render(<Page />);
    await userEvent.setup().tab();
    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveFocus();
  });

  it("moves the focus to the content when used, without changing the address", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("main")).toHaveFocus();
    expect(window.location.hash).toBe("");
  });

  it("also works with the mouse", async () => {
    render(<Page />);
    await userEvent.setup().click(screen.getByRole("link", { name: "Skip to main content" }));
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("does nothing, and does not fail, when the content is not on the page", async () => {
    render(<SkipLink targetId="nowhere">Skip</SkipLink>);
    await userEvent.setup().click(screen.getByRole("link"));
    expect(screen.getByRole("link")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Page />);
    await expectNoA11yViolations(container);
  });
});
