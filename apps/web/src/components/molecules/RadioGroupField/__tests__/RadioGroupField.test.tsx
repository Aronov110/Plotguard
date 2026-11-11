import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { RadioGroupField, type RadioOption } from "../RadioGroupField.tsx";

const OPTIONS: readonly RadioOption[] = [
  { value: "screenplay", label: "Screenplay", hint: "A film or TV script." },
  { value: "prose", label: "Prose", hint: "A novel or a story." },
  { value: "other", label: "Other" },
];

function renderGroup(props: Partial<Parameters<typeof RadioGroupField>[0]> = {}) {
  return render(
    <form>
      <RadioGroupField
        id="format"
        name="format"
        legend="Format"
        options={OPTIONS}
        defaultValue="screenplay"
        {...props}
      />
    </form>,
  );
}

describe("RadioGroupField", () => {
  it("is a group named by its question, with one radio button per option", () => {
    renderGroup();
    const group = screen.getByRole("group", { name: "Format" });
    expect(group.tagName).toBe("FIELDSET");
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: "Screenplay" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Prose" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Other" })).toBeInTheDocument();
  });

  it("starts with the default option chosen", () => {
    renderGroup({ defaultValue: "prose" });
    expect(screen.getByRole("radio", { name: "Prose" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Screenplay" })).not.toBeChecked();
  });

  it("builds the option ids from the group's id", () => {
    renderGroup();
    expect(screen.getByRole("radio", { name: "Prose" })).toHaveAttribute("id", "format-prose");
  });

  it("sends the chosen value with the form", async () => {
    const user = userEvent.setup();
    renderGroup();
    await user.click(screen.getByRole("radio", { name: "Other" }));
    const form = document.querySelector("form");
    expect(new FormData(form as HTMLFormElement).get("format")).toBe("other");
  });

  it("changes the choice with the arrow keys, the way radio buttons do", async () => {
    const user = userEvent.setup();
    renderGroup();
    screen.getByRole("radio", { name: "Screenplay" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: "Prose" })).toBeChecked();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("radio", { name: "Screenplay" })).toBeChecked();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("radio", { name: "Other" })).toBeChecked();
  });

  it("is one stop in the tab order, not one per option", async () => {
    const user = userEvent.setup();
    render(
      <form>
        <RadioGroupField
          id="format"
          name="format"
          legend="Format"
          options={OPTIONS}
          defaultValue="prose"
        />
        <button type="button">After</button>
      </form>,
    );
    await user.tab();
    expect(screen.getByRole("radio", { name: "Prose" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "After" })).toHaveFocus();
  });

  it("goes back to the default when the form is reset", async () => {
    const user = userEvent.setup();
    renderGroup();
    await user.click(screen.getByRole("radio", { name: "Other" }));
    (document.querySelector("form") as HTMLFormElement).reset();
    expect(screen.getByRole("radio", { name: "Screenplay" })).toBeChecked();
  });

  it("reads an option's hint out with that option", () => {
    renderGroup();
    expect(screen.getByRole("radio", { name: "Screenplay" })).toHaveAccessibleDescription(
      "A film or TV script.",
    );
    expect(screen.getByRole("radio", { name: "Other" })).not.toHaveAttribute("aria-describedby");
  });

  it("reads the group's hint with the group", () => {
    renderGroup({ hint: "Pick the closest one." });
    expect(screen.getByRole("group", { name: "Format" })).toHaveAccessibleDescription(
      "Pick the closest one.",
    );
  });

  it("shows an error, ties it to the group, and says 'Error:' in words", () => {
    renderGroup({ error: "Choose a format." });
    const group = screen.getByRole("group", { name: "Format" });
    expect(group).toHaveAccessibleDescription("Error: Choose a format.");
    expect(document.getElementById("format-error")).toHaveTextContent("Choose a format.");
  });

  it("reads the hint and then the error", () => {
    renderGroup({ hint: "A hint.", error: "An error." });
    expect(screen.getByRole("group", { name: "Format" })).toHaveAccessibleDescription(
      "A hint. Error: An error.",
    );
  });

  it("treats an empty error and an empty hint as none", () => {
    renderGroup({ hint: "", error: "" });
    expect(screen.getByRole("group", { name: "Format" })).not.toHaveAttribute("aria-describedby");
  });

  it("has no accessibility violations, plain and with an error", async () => {
    const { container } = renderGroup({ hint: "A hint.", error: "An error." });
    await expectNoA11yViolations(container);
  });
});
