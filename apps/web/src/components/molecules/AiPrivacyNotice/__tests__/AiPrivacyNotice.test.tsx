import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { AiPrivacyNotice } from "../AiPrivacyNotice.tsx";

describe("AiPrivacyNotice", () => {
  it("says that the text is sent to Anthropic, what is kept, and who handles it", () => {
    render(<AiPrivacyNotice id="privacy" />);
    const notice = screen.getByText(/sent to Anthropic/);
    expect(notice).toHaveTextContent("Before you run it:");
    expect(notice).toHaveTextContent("does not keep a second copy");
    expect(notice).toHaveTextContent("only the findings");
    expect(notice).toHaveTextContent("under its own terms");
  });

  it("has the id it is given, so that a button can be described by it", () => {
    render(<AiPrivacyNotice id="privacy-1" />);
    expect(screen.getByText(/sent to Anthropic/)).toHaveAttribute("id", "privacy-1");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<AiPrivacyNotice id="privacy" />);
    await expectNoA11yViolations(container);
  });
});
