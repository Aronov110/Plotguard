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

describe("AiPrivacyNotice for ideas", () => {
  it("says that the focus is sent too, and that it is saved with the ideas", () => {
    render(<AiPrivacyNotice id="privacy" kind="ideas" />);
    const notice = screen.getByText(/sent to Anthropic/);
    expect(notice).toHaveTextContent("Before you run it:");
    expect(notice).toHaveTextContent("and the focus if you write one");
    expect(notice).toHaveTextContent("does not keep a second copy");
    expect(notice).toHaveTextContent("saves only the ideas and your focus");
    expect(notice).toHaveTextContent("until you delete them");
    expect(notice).toHaveTextContent("under its own terms");
  });

  it("does not mention a focus for a plot-hole scan", () => {
    render(<AiPrivacyNotice id="privacy" kind="plot_holes" />);
    expect(screen.getByText(/sent to Anthropic/)).not.toHaveTextContent("focus");
  });

  it("keeps its id for ideas too", () => {
    render(<AiPrivacyNotice id="privacy-2" kind="ideas" />);
    expect(screen.getByText(/sent to Anthropic/)).toHaveAttribute("id", "privacy-2");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<AiPrivacyNotice id="privacy" kind="ideas" />);
    await expectNoA11yViolations(container);
  });
});
