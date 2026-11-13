import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ICON_NAMES, Icon } from "../Icon.tsx";

describe("Icon", () => {
  it.each(ICON_NAMES)("draws %s as a shape", (name) => {
    const { container } = render(<Icon name={name} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.querySelectorAll("path, circle, rect").length).toBeGreaterThan(0);
  });

  it("is hidden from screen readers and cannot take the focus", () => {
    const { container } = render(<Icon name="check" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
  });

  it("adds no text to the name of the button it sits in", () => {
    const { getByRole } = render(
      <button type="button">
        <Icon name="plus" />
        Add an item
      </button>,
    );
    expect(getByRole("button", { name: "Add an item" })).toBeInTheDocument();
  });

  it("has a small set of icons, each under its own name", () => {
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(15);
    expect(ICON_NAMES).toEqual(expect.arrayContaining(["sun", "moon", "monitor", "sparkles"]));
  });
});
