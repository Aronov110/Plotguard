import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoPageA11yViolations } from "../../../../test-support/a11y.ts";
import { CheckingSession } from "../CheckingSession.tsx";

describe("CheckingSession", () => {
  it("tells the person what is happening", () => {
    render(<CheckingSession />);
    expect(screen.getByRole("status")).toHaveTextContent("Checking your session…");
  });

  it("is a whole page: one main landmark and one level-one heading", () => {
    render(<CheckingSession />);
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Plotpal");
  });

  it("shows no form, no link and no button, so nothing can be used yet", () => {
    render(<CheckingSession />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("has no accessibility violations as a page", async () => {
    render(<CheckingSession />);
    await expectNoPageA11yViolations();
  });
});
