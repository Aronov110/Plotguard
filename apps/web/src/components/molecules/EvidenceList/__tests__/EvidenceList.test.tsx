import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { Evidence } from "../../../../lib/api/analyses-api.ts";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { EvidenceList } from "../EvidenceList.tsx";

const TITLES = new Map([
  ["doc-1", "The harbour"],
  ["doc-2", "The vault"],
]);

function renderList(
  evidence: readonly Evidence[],
  onOpenItem: (id: string) => void = () => undefined,
  titles: ReadonlyMap<string, string> = TITLES,
) {
  return render(
    <MemoryRouter initialEntries={["/app/projects/p-1/write?document=doc-1"]}>
      <EvidenceList
        evidence={evidence}
        titles={titles}
        label="Passages that show it"
        onOpenItem={onOpenItem}
      />
    </MemoryRouter>,
  );
}

describe("EvidenceList", () => {
  it("is a list named by the label it is given, with one entry for each passage", () => {
    renderList([
      { documentId: "doc-1", quote: "One.", verified: true },
      { documentId: "doc-2", quote: "Two.", verified: true },
    ]);
    const list = screen.getByRole("list", { name: "Passages that show it" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });

  it("marks a quote as found or not found in words", () => {
    renderList([
      { documentId: "doc-1", quote: "Real.", verified: true },
      { documentId: "doc-1", quote: "Made up.", verified: false },
    ]);
    expect(screen.getByText("Found in your text.")).toBeInTheDocument();
    expect(
      screen.getByText("Not found in your text. The AI may have invented or changed it."),
    ).toBeInTheDocument();
  });

  it("links a quote to its item, only when the item is still in the outline", async () => {
    const onOpenItem = vi.fn();
    renderList(
      [
        { documentId: "doc-2", quote: "One.", verified: true },
        { documentId: "gone", quote: "Two.", verified: true },
        { documentId: null, quote: "Three.", verified: false },
      ],
      onOpenItem,
    );
    expect(screen.getAllByRole("link")).toHaveLength(1);
    await userEvent.click(screen.getByRole("link", { name: "The vault" }));
    expect(onOpenItem).toHaveBeenCalledExactlyOnceWith("doc-2");
  });

  it("encodes the id in the link", () => {
    renderList(
      [{ documentId: "a&b=c", quote: "One.", verified: true }],
      () => undefined,
      new Map([["a&b=c", "Odd"]]),
    );
    expect(screen.getByRole("link", { name: "Odd" })).toHaveAttribute(
      "href",
      "/app/projects/p-1/write?document=a%26b%3Dc",
    );
  });

  it("shows the quote as plain text", () => {
    const { container } = renderList([
      { documentId: "doc-1", quote: "<b>bold</b><script>x</script>", verified: true },
    ]);
    expect(container.querySelector("b, script")).toBeNull();
    expect(screen.getByText("<b>bold</b><script>x</script>")).toBeInTheDocument();
  });

  it("shows two quotes that are the same", () => {
    renderList([
      { documentId: "doc-1", quote: "Same.", verified: true },
      { documentId: "doc-1", quote: "Same.", verified: true },
    ]);
    expect(screen.getAllByText("Same.")).toHaveLength(2);
  });

  it("has no accessibility violations", async () => {
    const { container } = renderList([
      { documentId: "doc-1", quote: "One.", verified: true },
      { documentId: "doc-2", quote: "Two.", verified: false },
    ]);
    await expectNoA11yViolations(container);
  });
});
