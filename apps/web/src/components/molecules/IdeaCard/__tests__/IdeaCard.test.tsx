import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { Idea } from "../../../../lib/api/analyses-api.ts";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { makeIdea } from "../../../../test-support/analyses-handlers.ts";
import { IdeaCard } from "../IdeaCard.tsx";

const TITLES = new Map([
  ["doc-1", "The harbour"],
  ["doc-2", "The vault"],
]);

function renderCard(
  idea: Idea,
  titles: ReadonlyMap<string, string> = TITLES,
  onOpenItem: (id: string) => void = () => undefined,
) {
  return render(
    <MemoryRouter initialEntries={["/app/projects/p-1/write?document=doc-1"]}>
      <ul>
        <IdeaCard idea={idea} titles={titles} onOpenItem={onOpenItem} />
      </ul>
    </MemoryRouter>,
  );
}

describe("IdeaCard", () => {
  it("shows the title and the kind of idea in words", () => {
    renderCard(makeIdea({ title: "The stranger returns", kind: "plot_twist" }));
    expect(
      screen.getByRole("heading", { level: 4, name: "The stranger returns" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Plot twist")).toBeInTheDocument();
  });

  it("shows an idea kind it has no wording for in a readable form", () => {
    renderCard(makeIdea({ kind: "a_new_kind" }));
    expect(screen.getByText("A new kind")).toBeInTheDocument();
  });

  it("shows the description and why it fits", () => {
    renderCard(
      makeIdea({ description: "Elena was never dead.", whyItFits: "The vault opens for Tomas." }),
    );
    expect(screen.getByText("Elena was never dead.")).toBeInTheDocument();
    expect(screen.getByText(/Why it fits:/).closest("p")).toHaveTextContent(
      "Why it fits: The vault opens for Tomas.",
    );
  });

  it("shows the quotes it builds on, found or not, in a named list", () => {
    renderCard(
      makeIdea({
        evidence: [
          { documentId: "doc-2", quote: "You are late.", verified: true },
          { documentId: "doc-1", quote: "Made up.", verified: false },
        ],
      }),
    );
    const list = screen.getByRole("list", { name: "Passages it builds on" });
    expect(within(list).getByText("You are late.")).toBeInTheDocument();
    expect(within(list).getByText("Found in your text.")).toBeInTheDocument();
    expect(
      within(list).getByText("Not found in your text. The AI may have invented or changed it."),
    ).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: "The vault" })).toHaveAttribute(
      "href",
      "/app/projects/p-1/write?document=doc-2",
    );
  });

  it("leaves out the list of passages when there are none", () => {
    renderCard(makeIdea({ evidence: [] }));
    expect(screen.queryByRole("list", { name: "Passages it builds on" })).not.toBeInTheDocument();
  });

  it("says where the idea could go, with a link to that item", () => {
    renderCard(makeIdea({ goesIn: "doc-2", evidence: [] }));
    const where = screen.getByText(/Could go in:/).closest("p");
    expect(where).toHaveTextContent("Could go in: The vault");
    expect(within(where as HTMLElement).getByRole("link", { name: "The vault" })).toHaveAttribute(
      "href",
      "/app/projects/p-1/write?document=doc-2",
    );
  });

  it("says nothing of a place for an idea about the story as a whole", () => {
    renderCard(makeIdea({ goesIn: null }));
    expect(screen.queryByText(/Could go in/)).not.toBeInTheDocument();
  });

  it("says nothing of a place that is no longer in the outline, or that every object has", () => {
    renderCard(makeIdea({ goesIn: "deleted", evidence: [] }));
    renderCard(makeIdea({ goesIn: "constructor", evidence: [] }));
    expect(screen.queryByText(/Could go in/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("encodes the id in the link, so that nothing in it can change the address", () => {
    renderCard(makeIdea({ goesIn: "a&b=c", evidence: [] }), new Map([["a&b=c", "Odd"]]));
    expect(screen.getByRole("link", { name: "Odd" })).toHaveAttribute(
      "href",
      "/app/projects/p-1/write?document=a%26b%3Dc",
    );
  });

  it("tells the screen which item a link opens, for the place and for a quote", async () => {
    const onOpenItem = vi.fn();
    renderCard(
      makeIdea({
        goesIn: "doc-2",
        evidence: [{ documentId: "doc-1", quote: "The lighthouse.", verified: true }],
      }),
      TITLES,
      onOpenItem,
    );
    await userEvent.click(screen.getByRole("link", { name: "The vault" }));
    expect(onOpenItem).toHaveBeenLastCalledWith("doc-2");
    await userEvent.click(screen.getByRole("link", { name: "The harbour" }));
    expect(onOpenItem).toHaveBeenLastCalledWith("doc-1");
    expect(onOpenItem).toHaveBeenCalledTimes(2);
  });

  it("does not tell the screen anything when no link is pressed", async () => {
    const onOpenItem = vi.fn();
    renderCard(makeIdea(), TITLES, onOpenItem);
    await userEvent.click(screen.getByText("Found in your text."));
    expect(onOpenItem).not.toHaveBeenCalled();
  });

  it("shows the AI's text as plain text, never as markup", () => {
    const { container } = renderCard(
      makeIdea({
        title: "<img src=x onerror=alert(1)>",
        description: "<b>bold</b>",
        whyItFits: "<script>alert(1)</script>",
        evidence: [{ documentId: "doc-1", quote: "<i>quote</i>", verified: true }],
      }),
    );
    expect(container.querySelector("img, b, i, script")).toBeNull();
    expect(screen.getByText("<b>bold</b>")).toBeInTheDocument();
    expect(screen.getByText("<i>quote</i>")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderCard(
      makeIdea({
        goesIn: "doc-2",
        evidence: [
          { documentId: "doc-1", quote: "One.", verified: true },
          { documentId: null, quote: "Two.", verified: false },
        ],
      }),
    );
    await expectNoA11yViolations(container);
  });
});
