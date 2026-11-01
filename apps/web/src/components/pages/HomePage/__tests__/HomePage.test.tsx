import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HomePage } from "../HomePage.tsx";

describe("HomePage", () => {
  it("renders a main landmark", () => {
    render(<HomePage />);
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("renders a single level-one heading with the app name", () => {
    render(<HomePage />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Plotguard");
  });

  it("renders the tagline", () => {
    render(<HomePage />);
    expect(screen.getByText(/catch what you missed/i)).toBeInTheDocument();
  });
});
