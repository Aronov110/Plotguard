import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { ChoiceOption, type ChoiceOptionProps } from "../ChoiceOption.tsx";

function renderOptions(props: Partial<ChoiceOptionProps> = {}) {
  return render(
    <fieldset>
      <legend>Where</legend>
      <ChoiceOption
        id="where-a"
        name="where"
        value="a"
        label="Inside “Act One”"
        hint="A scene."
        {...props}
      />
      <ChoiceOption id="where-b" name="where" value="b" label="At the top level" />
    </fieldset>,
  );
}

describe("ChoiceOption", () => {
  it("is a radio button named by its label", () => {
    renderOptions();
    expect(screen.getByRole("radio", { name: "Inside “Act One”" })).toBeInTheDocument();
  });

  it("reads its hint out with it, and has no description without a hint", () => {
    renderOptions();
    expect(screen.getByRole("radio", { name: "Inside “Act One”" })).toHaveAccessibleDescription(
      "A scene.",
    );
    expect(screen.getByRole("radio", { name: "At the top level" })).not.toHaveAttribute(
      "aria-describedby",
    );
  });

  it("starts checked or not, as a controlled or an uncontrolled option is told", () => {
    renderOptions({ defaultChecked: true });
    expect(screen.getByRole("radio", { name: "Inside “Act One”" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "At the top level" })).not.toBeChecked();
  });

  it("reports a choice that is made", async () => {
    const onChange = vi.fn();
    renderOptions({ onChange, checked: false });
    await userEvent.click(screen.getByRole("radio", { name: "Inside “Act One”" }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("is chosen by a click on its label text (a press anywhere else on the card reaches the radio button through the page's CSS, which the browser tests check)", async () => {
    const onChange = vi.fn();
    renderOptions({ onChange, checked: false });
    await userEvent.click(screen.getByText("Inside “Act One”"));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("moves with the arrow keys within its group", async () => {
    renderOptions({ defaultChecked: true });
    screen.getByRole("radio", { name: "Inside “Act One”" }).focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: "At the top level" })).toBeChecked();
  });

  it("cannot be chosen when disabled", async () => {
    const onChange = vi.fn();
    renderOptions({ disabled: true, onChange, checked: false });
    expect(screen.getByRole("radio", { name: "Inside “Act One”" })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "Inside “Act One”" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows a chosen option with a tick, hidden from screen readers", () => {
    const { container } = renderOptions({ defaultChecked: true });
    const tick = container.querySelector(".choice-option__tick svg");
    expect(tick).toHaveAttribute("data-icon", "check");
    expect(tick).toHaveAttribute("aria-hidden", "true");
  });

  it("shows a very long title in full, as text", () => {
    const title = `A title ${"x".repeat(300)} <b>not bold</b>`;
    const { container } = renderOptions({ label: title });
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByRole("radio", { name: title })).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderOptions({ defaultChecked: true });
    await expectNoA11yViolations(container);
  });

  it("does not dim a disabled card with opacity, so that its hint, which says why, stays readable", () => {
    // Vitest blanks CSS files other than tokens.css, so the stylesheet is read directly.
    const css = readFileSync(
      join(process.cwd(), "src", "components", "molecules", "ChoiceOption", "ChoiceOption.css"),
      "utf8",
    );
    const disabledRules = css.match(/\.choice-option\[data-disabled="true"\][^{]*\{[^}]*\}/g) ?? [];
    expect(disabledRules.length).toBeGreaterThan(0);
    for (const rule of disabledRules) expect(rule).not.toMatch(/opacity/);
  });
});
