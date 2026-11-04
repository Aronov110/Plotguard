import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { Label } from "../Label.tsx";

describe("Label", () => {
  it("names the field it points to", () => {
    render(
      <div>
        <Label htmlFor="email">Email</Label>
        <input id="email" />
      </div>,
    );
    expect(screen.getByLabelText("Email")).toBe(document.getElementById("email"));
  });

  it("moves the focus to the field when clicked", async () => {
    render(
      <div>
        <Label htmlFor="email">Email</Label>
        <input id="email" />
      </div>,
    );
    await userEvent.setup().click(screen.getByText("Email"));
    expect(screen.getByLabelText("Email")).toHaveFocus();
  });

  it("shows no marker for a required field", () => {
    render(
      <div>
        <Label htmlFor="a">Email</Label>
        <input id="a" />
      </div>,
    );
    expect(screen.queryByText(/optional/i)).not.toBeInTheDocument();
  });

  it("marks an optional field in words, not only with color", () => {
    render(
      <div>
        <Label htmlFor="a" optional>
          Display name
        </Label>
        <input id="a" />
      </div>,
    );
    expect(screen.getByText("(optional)")).toBeInTheDocument();
  });

  it("includes the optional marker in the field's name, so a screen reader hears it", () => {
    render(
      <div>
        <Label htmlFor="a" optional>
          Display name
        </Label>
        <input id="a" />
      </div>,
    );
    expect(screen.getByRole("textbox", { name: "Display name (optional)" })).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <div>
        <Label htmlFor="a">One</Label>
        <input id="a" />
        <Label htmlFor="b" optional>
          Two
        </Label>
        <input id="b" />
      </div>,
    );
    await expectNoA11yViolations(container);
  });
});
