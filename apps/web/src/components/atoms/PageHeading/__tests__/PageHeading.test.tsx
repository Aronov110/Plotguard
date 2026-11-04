import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { PageHeading } from "../PageHeading.tsx";

describe("PageHeading", () => {
  it("is the level-one heading of the page", () => {
    render(<PageHeading>Log in</PageHeading>);
    expect(screen.getByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
  });

  it("can be focused by code, so the focus can move here when the screen changes", () => {
    render(<PageHeading>Log in</PageHeading>);
    const heading = screen.getByRole("heading", { level: 1 });
    heading.focus();
    expect(heading).toHaveFocus();
  });

  it("is not in the tab order, so keyboard users do not stop on a title", async () => {
    render(
      <>
        <PageHeading>Title</PageHeading>
        <button type="button">After</button>
      </>,
    );
    await userEvent.setup().tab();
    expect(screen.getByRole("button", { name: "After" })).toHaveFocus();
  });

  it("shows markup in the title as plain text", () => {
    const { container } = render(<PageHeading>{"<b>x</b>"}</PageHeading>);
    expect(container.querySelector("b")).toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<PageHeading>Title</PageHeading>);
    await expectNoA11yViolations(container);
  });
});
