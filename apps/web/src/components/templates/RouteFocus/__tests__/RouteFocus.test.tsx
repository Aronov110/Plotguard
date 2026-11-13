import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useLayoutEffect, useRef } from "react";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { RouteFocus } from "../RouteFocus.tsx";

/** An editable element that takes the focus when it appears, as a writing area might. */
function EditableDraft() {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    // biome-ignore lint/a11y/useSemanticElements: an editable div is exactly the case under test
    <div
      ref={ref}
      role="textbox"
      aria-label="Draft"
      contentEditable
      suppressContentEditableWarning
      tabIndex={0}
    />
  );
}

function renderApp(strict = false) {
  const app = (
    <MemoryRouter initialEntries={["/"]}>
      <RouteFocus />
      <Routes>
        <Route
          path="/"
          element={
            <main>
              <h1 tabIndex={-1}>Home</h1>
              <Link to="/other">Go to other</Link>
              <Link to="/?filter=a">Same page, new query</Link>
              <Link to="/bare">Go to a page without a heading</Link>
              <Link to="/field">Go to a page with a field</Link>
              <Link to="/area">Go to a page with a text area</Link>
              <Link to="/select">Go to a page with a select</Link>
              <Link to="/editable">Go to a page with an editable element</Link>
              <Link to="/button">Go to a page with a focused button</Link>
              <Link to="/checkbox">Go to a page with a focused checkbox</Link>
            </main>
          }
        />
        <Route
          path="/other"
          element={
            <main>
              <h1 tabIndex={-1}>Other</h1>
            </main>
          }
        />
        <Route path="/bare" element={<main>No heading here</main>} />
        <Route
          path="/field"
          element={
            <main>
              <h1 tabIndex={-1}>Field page</h1>
              {/* biome-ignore lint/a11y/noAutofocus: the point of the test is a field that has the focus when the page opens */}
              <input aria-label="Name" autoFocus />
            </main>
          }
        />
        <Route
          path="/area"
          element={
            <main>
              <h1 tabIndex={-1}>Area page</h1>
              {/* biome-ignore lint/a11y/noAutofocus: see above */}
              <textarea aria-label="Notes" autoFocus />
            </main>
          }
        />
        <Route
          path="/select"
          element={
            <main>
              <h1 tabIndex={-1}>Select page</h1>
              {/* biome-ignore lint/a11y/noAutofocus: see above */}
              <select aria-label="Colour" autoFocus>
                <option>Red</option>
              </select>
            </main>
          }
        />
        <Route
          path="/editable"
          element={
            <main>
              <h1 tabIndex={-1}>Editable page</h1>
              <EditableDraft />
            </main>
          }
        />
        <Route
          path="/checkbox"
          element={
            <main>
              <h1 tabIndex={-1}>Checkbox page</h1>
              {/* biome-ignore lint/a11y/noAutofocus: see above */}
              <input type="checkbox" aria-label="Remember me" autoFocus />
            </main>
          }
        />
        <Route
          path="/button"
          element={
            <main>
              <h1 tabIndex={-1}>Button page</h1>
              {/* biome-ignore lint/a11y/noAutofocus: see above */}
              <button type="button" autoFocus>
                Start
              </button>
            </main>
          }
        />
      </Routes>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{app}</StrictMode> : app);
}

describe("RouteFocus", () => {
  it("does not take the focus when the page first loads", () => {
    renderApp();
    expect(document.body).toHaveFocus();
  });

  it("does not take the focus on first load under React's StrictMode either", () => {
    renderApp(true);
    expect(document.body).toHaveFocus();
  });

  it("moves the focus to the new screen's heading after a navigation", async () => {
    renderApp();
    await userEvent.setup().click(screen.getByRole("link", { name: "Go to other" }));
    expect(screen.getByRole("heading", { level: 1, name: "Other" })).toHaveFocus();
  });

  it("does the same under StrictMode", async () => {
    renderApp(true);
    await userEvent.setup().click(screen.getByRole("link", { name: "Go to other" }));
    expect(screen.getByRole("heading", { level: 1, name: "Other" })).toHaveFocus();
  });

  it("leaves the focus alone when only the query changes on the same page", async () => {
    renderApp();
    const link = screen.getByRole("link", { name: "Same page, new query" });
    await userEvent.setup().click(link);
    expect(link).toHaveFocus();
  });

  it("does not fail when the new screen has no heading", async () => {
    renderApp();
    await userEvent
      .setup()
      .click(screen.getByRole("link", { name: "Go to a page without a heading" }));
    expect(screen.getByText("No heading here")).toBeInTheDocument();
  });

  describe("when a field already has the focus", () => {
    it.each([
      ["a text field", "Go to a page with a field", "Name"],
      ["a text area", "Go to a page with a text area", "Notes"],
      ["a select", "Go to a page with a select", "Colour"],
    ])("does not take it away from %s", async (_what, linkName, fieldName) => {
      renderApp();
      await userEvent.setup().click(screen.getByRole("link", { name: linkName }));
      expect(screen.getByLabelText(fieldName)).toHaveFocus();
    });

    it("does not take it away from an editable element", async () => {
      renderApp();
      await userEvent
        .setup()
        .click(screen.getByRole("link", { name: "Go to a page with an editable element" }));
      expect(screen.getByRole("textbox", { name: "Draft" })).toHaveFocus();
    });

    it("does not take it away under StrictMode either", async () => {
      renderApp(true);
      await userEvent
        .setup()
        .click(screen.getByRole("link", { name: "Go to a page with a field" }));
      expect(screen.getByLabelText("Name")).toHaveFocus();
    });

    it("still moves the focus to the heading when a checkbox has it: nothing is typed there", async () => {
      renderApp();
      await userEvent
        .setup()
        .click(screen.getByRole("link", { name: "Go to a page with a focused checkbox" }));
      expect(screen.getByRole("heading", { level: 1, name: "Checkbox page" })).toHaveFocus();
    });

    it("still moves the focus to the heading when a button has it, as a link does", async () => {
      renderApp();
      await userEvent
        .setup()
        .click(screen.getByRole("link", { name: "Go to a page with a focused button" }));
      expect(screen.getByRole("heading", { level: 1, name: "Button page" })).toHaveFocus();
    });
  });
});
