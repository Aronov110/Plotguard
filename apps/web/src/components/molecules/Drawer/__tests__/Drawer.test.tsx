import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { Drawer } from "../Drawer.tsx";

/** A toggle button and a drawer, as a screen uses them. */
function Harness({
  initiallyOpen = false,
  onClose,
  children = <button type="button">Inside</button>,
}: {
  initiallyOpen?: boolean;
  onClose?: () => void;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls="drawer"
        onClick={() => {
          setOpen((previous) => !previous);
        }}
      >
        AI assistant
      </button>
      <Drawer
        id="drawer"
        open={open}
        title="AI assistant"
        returnFocusRef={toggleRef}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
      >
        {children}
      </Drawer>
    </>
  );
}

const toggle = () => screen.getByRole("button", { name: "AI assistant" });

describe("Drawer", () => {
  it("is a landmark named by its heading", () => {
    render(<Harness initiallyOpen />);
    const drawer = screen.getByRole("complementary", { name: "AI assistant" });
    expect(drawer).toHaveAttribute("id", "drawer");
    expect(screen.getByRole("heading", { level: 2, name: "AI assistant" })).toBeInTheDocument();
  });

  it("is closed and out of reach to start with, and does not take the focus", () => {
    const { container } = render(<Harness />);
    expect(container.querySelector("aside")).toHaveAttribute("inert");
    expect(container.querySelector("aside")).toHaveAttribute("data-open", "false");
    expect(document.body).toHaveFocus();
  });

  it("keeps what is inside it in the page while it is closed, so that work in it goes on", () => {
    render(
      <Harness>
        <p>A run is going</p>
      </Harness>,
    );
    expect(screen.getByText("A run is going")).toBeInTheDocument();
  });

  it("opens from the toggle and moves the focus to its heading", async () => {
    const { container } = render(<Harness />);
    await userEvent.click(toggle());
    expect(container.querySelector("aside")).not.toHaveAttribute("inert");
    expect(container.querySelector("aside")).toHaveAttribute("data-open", "true");
    expect(screen.getByRole("heading", { level: 2, name: "AI assistant" })).toHaveFocus();
  });

  it("does not take the focus when it is open from the start", () => {
    render(<Harness initiallyOpen />);
    expect(document.body).toHaveFocus();
  });

  it("closes with its Close button and gives the focus back to the toggle", async () => {
    const onClose = vi.fn();
    const { container } = render(<Harness initiallyOpen onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Close the panel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(container.querySelector("aside")).toHaveAttribute("inert");
    expect(toggle()).toHaveFocus();
  });

  it("closes with Escape from inside, and gives the focus back to the toggle", async () => {
    const onClose = vi.fn();
    render(<Harness initiallyOpen onClose={onClose} />);
    screen.getByRole("button", { name: "Inside" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(toggle()).toHaveFocus();
  });

  it("does not close on Escape pressed elsewhere on the page", async () => {
    const onClose = vi.fn();
    render(<Harness initiallyOpen onClose={onClose} />);
    toggle().focus();
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaves an Escape that something inside already handled alone", async () => {
    const onClose = vi.fn();
    render(
      <Harness initiallyOpen onClose={onClose}>
        <fieldset
          aria-label="A question"
          onKeyDown={(event) => {
            if (event.key === "Escape") event.stopPropagation();
          }}
        >
          <button type="button">Keep</button>
        </fieldset>
      </Harness>,
    );
    screen.getByRole("button", { name: "Keep" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close on Escape while it is already closed", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes from the toggle without moving the focus away from it", async () => {
    const { container } = render(<Harness initiallyOpen />);
    toggle().focus();
    await userEvent.click(toggle());
    expect(container.querySelector("aside")).toHaveAttribute("inert");
    expect(toggle()).toHaveFocus();
  });

  it("takes the focus again each time it is opened", async () => {
    render(<Harness />);
    await userEvent.click(toggle());
    await userEvent.click(toggle());
    await userEvent.click(toggle());
    expect(screen.getByRole("heading", { level: 2, name: "AI assistant" })).toHaveFocus();
  });

  it("is named by the toggle's aria-controls", () => {
    render(<Harness initiallyOpen />);
    expect(toggle()).toHaveAttribute("aria-controls", "drawer");
    expect(document.getElementById("drawer")).toBe(
      screen.getByRole("complementary", { name: "AI assistant" }),
    );
  });

  it("has no accessibility violations, open or closed", async () => {
    const { container, rerender } = render(<Harness initiallyOpen />);
    await expectNoA11yViolations(container);
    rerender(<Harness />);
    await expectNoA11yViolations(container);
  });
});
