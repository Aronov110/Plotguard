import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { makeEstimate } from "../../../../test-support/analyses-handlers.ts";
import { CostHint } from "../CostHint.tsx";

describe("CostHint", () => {
  it("shows nothing before the panel is opened", () => {
    const { container } = render(<CostHint view={{ status: "idle" }} onRetry={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says that the cost is being worked out", () => {
    render(<CostHint view={{ status: "loading" }} onRetry={() => undefined} />);
    expect(screen.getByRole("status")).toHaveTextContent("Working out the cost…");
  });

  it("gives the size, the price range and what is left of the allowance", () => {
    render(
      <CostHint
        view={{
          status: "ready",
          estimate: makeEstimate({
            characters: 180_000,
            costUsd: { low: 0.09, high: 0.33 },
            remaining: { runs: 7, tokens: 5 },
          }),
        }}
        onRetry={() => undefined}
      />,
    );
    const hint = screen.getByRole("status");
    expect(hint).toHaveTextContent("About 100 pages of text.");
    expect(hint).toHaveTextContent("Costs about $0.09 to $0.33.");
    expect(hint).toHaveTextContent("You have 7 scans left in the last 24 hours.");
    expect(hint).not.toHaveTextContent("too long");
  });

  it("warns when the text is too long for one scan", () => {
    render(
      <CostHint
        view={{ status: "ready", estimate: makeEstimate({ fits: false }) }}
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "This text is too long for one scan. Choose a single act or scene.",
    );
  });

  it("says in words when the price is not known", () => {
    render(
      <CostHint
        view={{ status: "ready", estimate: makeEstimate({ costUsd: null }) }}
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("The cost of this model is not known.");
  });

  it("shows what went wrong and offers to try again", async () => {
    const onRetry = vi.fn();
    render(<CostHint view={{ status: "failed", message: "Could not load." }} onRetry={onRetry} />);
    expect(screen.getByText("Could not load.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("has no accessibility violations in any state", async () => {
    const { container } = render(
      <div>
        <CostHint view={{ status: "loading" }} onRetry={() => undefined} />
        <CostHint
          view={{ status: "ready", estimate: makeEstimate({ fits: false }) }}
          onRetry={() => undefined}
        />
        <CostHint view={{ status: "failed", message: "Nope." }} onRetry={() => undefined} />
      </div>,
    );
    await expectNoA11yViolations(container);
  });
});
