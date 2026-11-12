import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { Finding } from "../../../../lib/api/analyses-api.ts";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { makeFinding } from "../../../../test-support/analyses-handlers.ts";
import { FindingCard } from "../FindingCard.tsx";

const TITLES = new Map([
  ["doc-1", "The harbour"],
  ["doc-2", "The vault"],
]);

function renderCard(
  finding: Finding,
  titles: ReadonlyMap<string, string> = TITLES,
  onOpenItem: (id: string) => void = () => undefined,
) {
  return render(
    <MemoryRouter initialEntries={["/app/projects/p-1/write?document=doc-1"]}>
      <ul>
        <FindingCard finding={finding} titles={titles} onOpenItem={onOpenItem} />
      </ul>
    </MemoryRouter>,
  );
}

describe("FindingCard", () => {
  it("shows the title, the severity and the kind of problem in words", () => {
    renderCard(
      makeFinding({ title: "Elena is alive again", severity: "major", category: "continuity" }),
    );
    expect(
      screen.getByRole("heading", { level: 4, name: "Elena is alive again" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Major")).toBeInTheDocument();
    expect(screen.getByText("Continuity")).toBeInTheDocument();
  });

  it("explains each severity in a tooltip text", () => {
    renderCard(makeFinding({ severity: "minor" }));
    expect(screen.getByText("Minor")).toHaveAttribute("title", "Minor: small");
  });

  it("shows the explanation and the suggestion", () => {
    renderCard(
      makeFinding({ explanation: "She died in scene one.", suggestion: "Cut scene two." }),
    );
    expect(screen.getByText("She died in scene one.")).toBeInTheDocument();
    expect(screen.getByText(/A way to fix it:/).closest("p")).toHaveTextContent(
      "A way to fix it: Cut scene two.",
    );
  });

  it("leaves out the suggestion when there is none", () => {
    renderCard(makeFinding({ suggestion: "" }));
    expect(screen.queryByText(/A way to fix it/)).not.toBeInTheDocument();
  });

  it("shows a quote that is in the text as found, with a link to its item", () => {
    renderCard(
      makeFinding({
        evidence: [{ documentId: "doc-2", quote: "You are late.", verified: true }],
      }),
    );
    const list = screen.getByRole("list", { name: "Passages that show it" });
    expect(within(list).getByText("You are late.")).toBeInTheDocument();
    expect(within(list).getByText("Found in your text.")).toBeInTheDocument();
    const link = within(list).getByRole("link", { name: "The vault" });
    expect(link).toHaveAttribute("href", "/app/projects/p-1/write?document=doc-2");
  });

  it("warns, in words, about a quote that is not in the text", () => {
    renderCard(
      makeFinding({
        evidence: [{ documentId: "doc-1", quote: "Made up.", verified: false }],
      }),
    );
    expect(
      screen.getByText("Not found in your text. The AI may have invented or changed it."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Found in your text.")).not.toBeInTheDocument();
  });

  it("links to nothing for an item that is no longer in the outline, or an unknown one", () => {
    renderCard(
      makeFinding({
        evidence: [
          { documentId: "deleted", quote: "One.", verified: true },
          { documentId: null, quote: "Two.", verified: false },
        ],
      }),
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("does not take an id that every object has for an item", () => {
    renderCard(
      makeFinding({ evidence: [{ documentId: "constructor", quote: "One.", verified: true }] }),
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("encodes the id in the link, so that nothing in it can change the address", () => {
    renderCard(
      makeFinding({ evidence: [{ documentId: "a&b=c", quote: "One.", verified: true }] }),
      new Map([["a&b=c", "Odd"]]),
    );
    expect(screen.getByRole("link", { name: "Odd" })).toHaveAttribute(
      "href",
      "/app/projects/p-1/write?document=a%26b%3Dc",
    );
  });

  it("shows the AI's text as plain text, never as markup", () => {
    const { container } = renderCard(
      makeFinding({
        title: "<img src=x onerror=alert(1)>",
        explanation: "<b>bold</b>",
        suggestion: "<script>alert(1)</script>",
        evidence: [{ documentId: "doc-1", quote: "<i>quote</i>", verified: true }],
      }),
    );
    expect(container.querySelector("img, b, i, script")).toBeNull();
    expect(screen.getByText("<b>bold</b>")).toBeInTheDocument();
    expect(screen.getByText("<i>quote</i>")).toBeInTheDocument();
  });

  it("shows a kind of problem it has no wording for in a readable form", () => {
    renderCard(makeFinding({ category: "a_new_kind" }));
    expect(screen.getByText("A new kind")).toBeInTheDocument();
  });

  it("shows two quotes that are the same", () => {
    renderCard(
      makeFinding({
        evidence: [
          { documentId: "doc-1", quote: "Same.", verified: true },
          { documentId: "doc-1", quote: "Same.", verified: true },
        ],
      }),
    );
    expect(screen.getAllByText("Same.")).toHaveLength(2);
  });

  it("tells the screen which item a link opens, so that the text can take the focus", async () => {
    const onOpenItem = vi.fn();
    renderCard(
      makeFinding({
        evidence: [
          { documentId: "doc-2", quote: "You are late.", verified: true },
          { documentId: "doc-1", quote: "The lighthouse.", verified: true },
        ],
      }),
      TITLES,
      onOpenItem,
    );
    await userEvent.click(screen.getByRole("link", { name: "The vault" }));
    expect(onOpenItem).toHaveBeenCalledTimes(1);
    expect(onOpenItem).toHaveBeenLastCalledWith("doc-2");

    await userEvent.click(screen.getByRole("link", { name: "The harbour" }));
    expect(onOpenItem).toHaveBeenCalledTimes(2);
    expect(onOpenItem).toHaveBeenLastCalledWith("doc-1");
  });

  it("does not tell the screen anything when no link is pressed", async () => {
    const onOpenItem = vi.fn();
    renderCard(makeFinding(), TITLES, onOpenItem);
    await userEvent.click(screen.getByText("Found in your text."));
    expect(onOpenItem).not.toHaveBeenCalled();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderCard(
      makeFinding({
        evidence: [
          { documentId: "doc-1", quote: "One.", verified: true },
          { documentId: "doc-2", quote: "Two.", verified: false },
        ],
      }),
    );
    await expectNoA11yViolations(container);
  });
});
