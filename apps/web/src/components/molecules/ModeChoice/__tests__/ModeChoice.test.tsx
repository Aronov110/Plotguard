import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { ModeChoice } from "../ModeChoice.tsx";

describe("ModeChoice", () => {
  it("is a group with a question and two choices, each with its explanation", () => {
    render(<ModeChoice value="plot_holes" onChange={() => undefined} disabled={false} />);
    const group = screen.getByRole("group", { name: "What do you want?" });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByRole("radio", { name: "Find plot holes" })).toHaveAccessibleDescription(
      /contradicts itself/,
    );
    expect(screen.getByRole("radio", { name: "Get ideas" })).toHaveAccessibleDescription(
      /suggestions, not corrections/,
    );
  });

  it.each([
    ["plot_holes", "Find plot holes", "Get ideas"],
    ["ideas", "Get ideas", "Find plot holes"],
  ] as const)("checks only the chosen one when the value is %s", (value, on, off) => {
    render(<ModeChoice value={value} onChange={() => undefined} disabled={false} />);
    expect(screen.getByRole("radio", { name: on })).toBeChecked();
    expect(screen.getByRole("radio", { name: off })).not.toBeChecked();
  });

  it("tells the new choice when one is pressed", async () => {
    const onChange = vi.fn();
    render(<ModeChoice value="plot_holes" onChange={onChange} disabled={false} />);
    await userEvent.click(screen.getByRole("radio", { name: "Get ideas" }));
    expect(onChange).toHaveBeenCalledWith("ideas");
  });

  it("moves with the arrow keys", async () => {
    const onChange = vi.fn();
    render(<ModeChoice value="plot_holes" onChange={onChange} disabled={false} />);
    screen.getByRole("radio", { name: "Find plot holes" }).focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenCalledWith("ideas");
  });

  it("cannot be changed while a run goes, and still shows the choice", async () => {
    const onChange = vi.fn();
    render(<ModeChoice value="ideas" onChange={onChange} disabled />);
    expect(screen.getByRole("radio", { name: "Get ideas" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Get ideas" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Find plot holes" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <ModeChoice value="ideas" onChange={() => undefined} disabled={false} />,
    );
    await expectNoA11yViolations(container);
  });
});
