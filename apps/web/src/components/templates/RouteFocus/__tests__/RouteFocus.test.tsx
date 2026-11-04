import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { RouteFocus } from "../RouteFocus.tsx";

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
});
