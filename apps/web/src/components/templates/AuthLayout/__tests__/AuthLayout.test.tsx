import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoPageA11yViolations } from "../../../../test-support/a11y.ts";
import { AuthLayout } from "../AuthLayout.tsx";

describe("AuthLayout", () => {
  it("is a page: one main landmark with the title as its level-one heading", () => {
    render(
      <AuthLayout title="Log in">
        <p>Form goes here</p>
      </AuthLayout>,
    );
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
  });

  it("shows what it is given", () => {
    render(
      <AuthLayout title="Log in">
        <p>Form goes here</p>
      </AuthLayout>,
    );
    expect(screen.getByText("Form goes here")).toBeInTheDocument();
  });

  it("shows a footer when it has one, and nothing when it has not", () => {
    const { rerender } = render(
      <AuthLayout title="Log in" footer={<a href="/register">Create one</a>}>
        <p>Body</p>
      </AuthLayout>,
    );
    expect(screen.getByRole("link", { name: "Create one" })).toBeInTheDocument();
    rerender(
      <AuthLayout title="Log in">
        <p>Body</p>
      </AuthLayout>,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("keeps the heading before the content in reading order", () => {
    render(
      <AuthLayout title="Log in">
        <p>Body</p>
      </AuthLayout>,
    );
    const heading = screen.getByRole("heading", { level: 1 });
    const body = screen.getByText("Body");
    expect(heading.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("has no accessibility violations as a page", async () => {
    render(
      <AuthLayout title="Log in" footer={<a href="/register">Create one</a>}>
        <p>Body</p>
      </AuthLayout>,
    );
    await expectNoPageA11yViolations();
  });
});
