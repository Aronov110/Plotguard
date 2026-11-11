import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { buildTree } from "../../../../lib/documents/use-outline.ts";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { makeOutlineItem } from "../../../../test-support/documents-handlers.ts";
import { documentSearch, OutlineNav } from "../OutlineNav.tsx";

const act1 = makeOutlineItem({ title: "Act One", wordCount: 120 });
const a = makeOutlineItem({ title: "The Lighthouse", parentId: act1.id, wordCount: 1 });
const b = makeOutlineItem({ title: "The Storm", parentId: act1.id, wordCount: 0 });
const act2 = makeOutlineItem({ title: "Act Two", wordCount: 5 });
const tree = buildTree([act1, a, b, act2]);

function renderNav(selectedId: string | undefined = undefined, nodes = tree) {
  const onSelect = vi.fn();
  const view = render(
    <MemoryRouter>
      <OutlineNav nodes={nodes} selectedId={selectedId} onSelect={onSelect} />
    </MemoryRouter>,
  );
  return { ...view, onSelect, user: userEvent.setup() };
}

describe("OutlineNav", () => {
  it("is a navigation named Outline", () => {
    renderNav();
    const nav = screen.getByRole("navigation", { name: "Outline" });
    expect(within(nav).getByRole("heading", { level: 2, name: "Outline" })).toBeVisible();
  });

  it("lists every item as a link with its words, scenes inside their act", () => {
    renderNav();
    const nav = screen.getByRole("navigation", { name: "Outline" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Act One", "The Lighthouse", "The Storm", "Act Two"]);

    const [first, second] = within(nav)
      .getAllByRole("listitem")
      .filter((item) => item.parentElement?.parentElement === nav);
    expect(first).toHaveTextContent("Act One");
    expect(first).toHaveTextContent("120 words");
    expect(within(first as HTMLElement).getAllByRole("link")).toHaveLength(3);
    expect(within(second as HTMLElement).getAllByRole("link")).toHaveLength(1);
  });

  it("says one word in the singular and zero words", () => {
    renderNav();
    expect(screen.getByText("1 word")).toBeVisible();
    expect(screen.getByText("0 words")).toBeVisible();
  });

  it("leads each link to the same screen with the item in the query string", () => {
    renderNav();
    expect(screen.getByRole("link", { name: "The Storm" })).toHaveAttribute(
      "href",
      `/?document=${b.id}`,
    );
  });

  it("marks the open item as the current page, and no other", () => {
    renderNav(a.id);
    expect(screen.getByRole("link", { name: "The Lighthouse" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const name of ["Act One", "The Storm", "Act Two"]) {
      expect(screen.getByRole("link", { name })).not.toHaveAttribute("aria-current");
    }
  });

  it("marks nothing when no item is open or the id is unknown", () => {
    renderNav("unknown");
    expect(screen.queryByRole("link", { current: "page" })).not.toBeInTheDocument();
  });

  it("tells the screen which item was chosen", async () => {
    const { user, onSelect } = renderNav();
    await user.click(screen.getByRole("link", { name: "Act Two" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(act2.id);
  });

  it("can be used with the keyboard alone", async () => {
    const { user, onSelect } = renderNav();
    screen.getByRole("link", { name: "The Lighthouse" }).focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(a.id);
  });

  it("says how to start when the outline is empty", () => {
    renderNav(undefined, []);
    expect(screen.getByText(/This project has no outline yet/)).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows titles with markup as text, and encodes an id with odd characters", () => {
    const odd = makeOutlineItem({ title: "<b>Bold?</b> & more", id: "a b/c?d" });
    renderNav(undefined, buildTree([odd]));
    const link = screen.getByRole("link");
    expect(link).toHaveTextContent("<b>Bold?</b> & more");
    expect(document.querySelector("nav b")).toBeNull();
    expect(link).toHaveAttribute("href", "/?document=a%20b%2Fc%3Fd");
  });

  it("shows a very long title in full", () => {
    const long = makeOutlineItem({ title: "w".repeat(300) });
    renderNav(undefined, buildTree([long]));
    expect(screen.getByRole("link")).toHaveTextContent("w".repeat(300));
  });

  it("has no accessibility violations, with and without an open item or an outline", async () => {
    const { container } = render(
      <MemoryRouter>
        <OutlineNav nodes={tree} selectedId={b.id} onSelect={vi.fn()} />
      </MemoryRouter>,
    );
    await expectNoA11yViolations(container);
    const empty = render(
      <MemoryRouter>
        <OutlineNav nodes={[]} selectedId={undefined} onSelect={vi.fn()} />
      </MemoryRouter>,
    );
    await expectNoA11yViolations(empty.container);
  });
});

describe("documentSearch", () => {
  it("builds the query string that opens a document", () => {
    expect(documentSearch("abc")).toBe("?document=abc");
  });

  it("encodes everything that could end the value early", () => {
    expect(documentSearch("a&b=c#d e")).toBe("?document=a%26b%3Dc%23d%20e");
  });
});
