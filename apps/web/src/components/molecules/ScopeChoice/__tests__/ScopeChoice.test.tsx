import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { ScopeChoice } from "../ScopeChoice.tsx";

describe("ScopeChoice", () => {
  it("offers the open item by name and the whole project, as a group with a question", () => {
    render(
      <ScopeChoice value="item" onChange={() => undefined} itemTitle="Act 1" disabled={false} />,
    );
    expect(screen.getByRole("group", { name: "What should it read?" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "The open item: “Act 1”" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "The whole project" })).not.toBeChecked();
  });

  it("checks the whole project when that is the value", () => {
    render(
      <ScopeChoice value="project" onChange={() => undefined} itemTitle="Act 1" disabled={false} />,
    );
    expect(screen.getByRole("radio", { name: "The whole project" })).toBeChecked();
  });

  it("reports the choice that is made", async () => {
    const onChange = vi.fn();
    render(<ScopeChoice value="item" onChange={onChange} itemTitle="Act 1" disabled={false} />);
    await userEvent.click(screen.getByRole("radio", { name: "The whole project" }));
    expect(onChange).toHaveBeenCalledWith("project");
  });

  it("moves the choice with the arrow keys", async () => {
    const onChange = vi.fn();
    render(<ScopeChoice value="item" onChange={onChange} itemTitle="Act 1" disabled={false} />);
    screen.getByRole("radio", { name: "The open item: “Act 1”" }).focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenCalledWith("project");
  });

  it("cannot choose the item when none is open, and says why", () => {
    render(
      <ScopeChoice
        value="project"
        onChange={() => undefined}
        itemTitle={undefined}
        disabled={false}
      />,
    );
    const item = screen.getByRole("radio", { name: "The open item" });
    expect(item).toBeDisabled();
    expect(item).toHaveAccessibleDescription("Open an item in the outline to choose this.");
  });

  it("cannot be changed while a scan is going", () => {
    render(<ScopeChoice value="item" onChange={() => undefined} itemTitle="Act 1" disabled />);
    expect(screen.getByRole("radio", { name: "The whole project" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /The open item/ })).toBeDisabled();
  });

  it("shows a very long title in full, as text", () => {
    const title = "A".repeat(300);
    render(
      <ScopeChoice value="item" onChange={() => undefined} itemTitle={title} disabled={false} />,
    );
    expect(screen.getByRole("radio", { name: `The open item: “${title}”` })).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <ScopeChoice value="item" onChange={() => undefined} itemTitle="Act 1" disabled={false} />,
    );
    await expectNoA11yViolations(container);
  });
});
