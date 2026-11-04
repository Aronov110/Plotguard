import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { Button } from "../Button.tsx";

describe("Button", () => {
  it("is a button with the given name", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("does not submit a form unless it is asked to", async () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button>Plain</Button>
      </form>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Plain" }));
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits a form when its type is submit", async () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit">Send</Button>
      </form>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("is primary unless it is secondary", () => {
    const { rerender } = render(<Button>One</Button>);
    expect(screen.getByRole("button")).toHaveClass("button", "button--primary");
    rerender(<Button variant="secondary">One</Button>);
    expect(screen.getByRole("button")).toHaveClass("button", "button--secondary");
    expect(screen.getByRole("button")).not.toHaveClass("button--primary");
  });

  it("calls onClick when clicked, and when pressed with Enter or Space", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Go</Button>);
    const button = screen.getByRole("button");

    await user.click(button);
    button.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");

    expect(onClick).toHaveBeenCalledTimes(3);
  });

  describe("busy", () => {
    it("says so to assistive technology and keeps its label", () => {
      render(<Button busy>Sign in</Button>);
      const button = screen.getByRole("button", { name: "Sign in" });
      expect(button).toHaveAttribute("aria-busy", "true");
      expect(button).toHaveAttribute("aria-disabled", "true");
    });

    it("stays focusable, so the keyboard user does not lose their place", async () => {
      render(<Button busy>Sign in</Button>);
      const button = screen.getByRole("button");
      expect(button).not.toBeDisabled();
      button.focus();
      expect(button).toHaveFocus();
    });

    it("ignores clicks and key presses", async () => {
      const onClick = vi.fn();
      const user = userEvent.setup();
      render(
        <Button busy onClick={onClick}>
          Sign in
        </Button>,
      );
      await user.click(screen.getByRole("button"));
      screen.getByRole("button").focus();
      await user.keyboard("{Enter}");
      await user.keyboard(" ");
      expect(onClick).not.toHaveBeenCalled();
    });

    it("does not submit a form", async () => {
      const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
      render(
        <form onSubmit={onSubmit}>
          <Button busy type="submit">
            Sign in
          </Button>
        </form>,
      );
      await userEvent.setup().click(screen.getByRole("button"));
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("has no busy attributes when it is not busy", () => {
      render(<Button>Sign in</Button>);
      const button = screen.getByRole("button");
      expect(button).not.toHaveAttribute("aria-busy");
      expect(button).not.toHaveAttribute("aria-disabled");
    });
  });

  it("can be disabled for real", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Off
      </Button>,
    );
    expect(screen.getByRole("button")).toBeDisabled();
    await userEvent.setup().click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("passes other attributes on to the button", () => {
    render(
      <Button aria-pressed="true" aria-controls="x" name="thing">
        Toggle
      </Button>,
    );
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAttribute("aria-controls", "x");
    expect(button).toHaveAttribute("name", "thing");
  });

  it("has no accessibility violations in any state", async () => {
    const { container } = render(
      <div>
        <Button>One</Button>
        <Button variant="secondary">Two</Button>
        <Button busy>Three</Button>
        <Button disabled>Four</Button>
      </div>,
    );
    await expectNoA11yViolations(container);
  });
});
