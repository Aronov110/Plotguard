import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { Analysis } from "../../../../lib/api/analyses-api.ts";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import {
  makeIdea,
  makeIdeasAnalysis,
  makeIdeasSucceeded,
} from "../../../../test-support/analyses-handlers.ts";
import { AnalysisResult } from "../AnalysisResult.tsx";

const TITLES = new Map([
  ["doc-1", "The harbour"],
  ["doc-2", "The vault"],
]);

function renderResult(
  analysis: Analysis,
  onClose: () => void = () => undefined,
  onOpenItem: (id: string) => void = () => undefined,
) {
  return render(
    <MemoryRouter>
      <AnalysisResult
        analysis={analysis}
        titles={TITLES}
        onClose={onClose}
        onOpenItem={onOpenItem}
      />
    </MemoryRouter>,
  );
}

describe("AnalysisResult, for ideas", () => {
  it("names what it read and when, as ideas, in the heading", () => {
    renderResult(
      makeIdeasSucceeded([makeIdea()], {
        scope: "document",
        documentId: "doc-1",
        createdAt: "2026-11-12T10:05:00.000Z",
      }),
    );
    const heading = screen.getByRole("heading", { level: 3 });
    expect(heading).toHaveTextContent(/^Ideas for “The harbour”, /);
    expect(heading).not.toHaveTextContent("Scan");
  });

  it("says the whole project for ideas on everything", () => {
    renderResult(makeIdeasSucceeded([makeIdea()]));
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      "Ideas for the whole project",
    );
  });

  it("shows the focus that was asked for, as plain text", () => {
    renderResult(makeIdeasSucceeded([makeIdea()], { focus: "who the <b>stranger</b> was" }));
    expect(screen.getByText(/You asked for ideas about:/).closest("p")).toHaveTextContent(
      "You asked for ideas about: who the <b>stranger</b> was",
    );
    expect(document.querySelector("p b")).toBeNull();
  });

  it("shows no focus line when there was none", () => {
    renderResult(makeIdeasSucceeded([makeIdea()], { focus: null }));
    expect(screen.queryByText(/You asked for ideas about/)).not.toBeInTheDocument();
  });

  it("shows the focus above the reason an idea request did not finish", () => {
    renderResult(
      makeIdeasAnalysis({ status: "failed", errorCode: "timeout", focus: "a stronger ending" }),
    );
    expect(screen.getByText(/You asked for ideas about:/)).toBeInTheDocument();
    expect(screen.getByText(/The idea request took too long/)).toBeInTheDocument();
  });

  it("shows the summary, the facts, a caution and the ideas in a named list, in order", () => {
    renderResult(
      makeIdeasSucceeded([makeIdea({ title: "First" }), makeIdea({ title: "Second" })], {
        result: {
          summary: "The story could go two ways.",
          ideas: [makeIdea({ title: "First" }), makeIdea({ title: "Second" })],
          read: { items: 2, characters: 525 },
        },
      }),
    );
    expect(screen.getByText("The story could go two ways.")).toBeInTheDocument();
    expect(screen.getByText(/2 ideas\./)).toBeInTheDocument();
    expect(screen.getByText(/These are suggestions/)).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Ideas" });
    const titles = within(list)
      .getAllByRole("heading", { level: 4 })
      .map((heading) => heading.textContent);
    expect(titles).toEqual(["First", "Second"]);
  });

  it("says plainly that no ideas came up", () => {
    renderResult(makeIdeasSucceeded([]));
    expect(screen.getByText(/No ideas came up this time/)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Ideas" })).not.toBeInTheDocument();
    expect(screen.queryByText(/These are suggestions/)).not.toBeInTheDocument();
  });

  it("does not talk about findings or plot holes", () => {
    const { container } = renderResult(makeIdeasSucceeded([makeIdea()]));
    expect(container).not.toHaveTextContent(/finding|plot hole/i);
  });

  it("says what happened to an idea request that did not finish, as an idea request", () => {
    renderResult(makeIdeasAnalysis({ status: "failed", errorCode: "canceled" }));
    expect(screen.getByText("You cancelled this idea request.")).toBeInTheDocument();
  });

  it("does not show the code of a failure", () => {
    renderResult(makeIdeasAnalysis({ status: "failed", errorCode: "something_new" }));
    expect(screen.queryByText(/something_new/)).not.toBeInTheDocument();
    expect(screen.getByText(/did not finish/)).toBeInTheDocument();
  });

  it("treats a finished run without a result as one that did not finish", () => {
    renderResult(makeIdeasAnalysis({ status: "succeeded", result: null }));
    expect(screen.getByText(/did not finish/)).toBeInTheDocument();
  });

  it("closes when the button is pressed", async () => {
    const onClose = vi.fn();
    renderResult(makeIdeasSucceeded([makeIdea()]), onClose);
    await userEvent.click(screen.getByRole("button", { name: "Close this result" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("passes on which item a link in an idea opens, for a quote and for where it goes", async () => {
    const onOpenItem = vi.fn();
    renderResult(
      makeIdeasSucceeded([
        makeIdea({
          goesIn: "doc-2",
          evidence: [{ documentId: "doc-1", quote: "The lighthouse.", verified: true }],
        }),
      ]),
      () => undefined,
      onOpenItem,
    );
    await userEvent.click(screen.getByRole("link", { name: "The harbour" }));
    expect(onOpenItem).toHaveBeenLastCalledWith("doc-1");
    await userEvent.click(screen.getByRole("link", { name: "The vault" }));
    expect(onOpenItem).toHaveBeenLastCalledWith("doc-2");
  });

  it("has a heading that can take the focus", () => {
    renderResult(makeIdeasSucceeded([makeIdea()]));
    expect(screen.getByRole("heading", { level: 3 })).toHaveAttribute("tabindex", "-1");
  });

  it("has no accessibility violations", async () => {
    const { container } = renderResult(
      makeIdeasSucceeded([makeIdea({ goesIn: "doc-2" }), makeIdea({ goesIn: null })], {
        focus: "who the stranger was",
      }),
    );
    await expectNoA11yViolations(container);
  });
});
