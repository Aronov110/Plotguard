import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { SegmentedControl, type SegmentedOption } from "../SegmentedControl.tsx";

type Mode = "plot_holes" | "ideas" | "other";
const OPTIONS: readonly SegmentedOption<Mode>[] = [
  { value: "plot_holes", label: "Find plot holes", icon: "alert" },
  { value: "ideas", label: "Get ideas", icon: "sparkles" },
];

function renderControl(
  props: {
    value?: Mode;
    onChange?: (value: Mode) => void;
    disabled?: boolean;
    hideLegend?: boolean;
  } = {},
) {
  return render(
    <SegmentedControl<Mode>
      legend="What do you want?"
      options={OPTIONS}
      value={props.value ?? "plot_holes"}
      onChange={props.onChange ?? (() => undefined)}
      {...(props.disabled === undefined ? {} : { disabled: props.disabled })}
      {...(props.hideLegend === undefined ? {} : { hideLegend: props.hideLegend })}
    />,
  );
}

describe("SegmentedControl", () => {
  it("is a group with a question and one radio button for each option", () => {
    renderControl();
    expect(screen.getByRole("group", { name: "What do you want?" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByRole("radio", { name: "Find plot holes" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Get ideas" })).toBeInTheDocument();
  });

  it("checks only the chosen option", () => {
    renderControl({ value: "ideas" });
    expect(screen.getByRole("radio", { name: "Get ideas" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Find plot holes" })).not.toBeChecked();
  });

  it("checks nothing for a value that is not among the options", () => {
    const { container } = renderControl({ value: "other" });
    expect(screen.getAllByRole("radio").some((radio) => (radio as HTMLInputElement).checked)).toBe(
      false,
    );
    expect(container.querySelector(".segmented__track")).toHaveAttribute("data-empty", "true");
  });

  it("tells the new value when an option is pressed", async () => {
    const onChange = vi.fn();
    renderControl({ onChange });
    await userEvent.click(screen.getByRole("radio", { name: "Get ideas" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("ideas");
  });

  it("can be pressed by its label text", async () => {
    const onChange = vi.fn();
    renderControl({ onChange });
    await userEvent.click(screen.getByText("Get ideas"));
    expect(onChange).toHaveBeenCalledWith("ideas");
  });

  it("moves with the arrow keys, as radio buttons do", async () => {
    const onChange = vi.fn();
    renderControl({ onChange });
    screen.getByRole("radio", { name: "Find plot holes" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenCalledWith("ideas");
  });

  it("tells the marker where to slide, by the position of the chosen option", () => {
    const { container, rerender } = renderControl({ value: "plot_holes" });
    const track = container.querySelector<HTMLElement>(".segmented__track");
    expect(track?.style.getPropertyValue("--count")).toBe("2");
    expect(track?.style.getPropertyValue("--index")).toBe("0");
    rerender(
      <SegmentedControl<Mode>
        legend="What do you want?"
        options={OPTIONS}
        value="ideas"
        onChange={() => undefined}
      />,
    );
    expect(track?.style.getPropertyValue("--index")).toBe("1");
  });

  it("works with three options", () => {
    const { container } = render(
      <SegmentedControl
        legend="Theme"
        options={[
          { value: "system", label: "System" },
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
        value="dark"
        onChange={() => undefined}
      />,
    );
    const track = container.querySelector<HTMLElement>(".segmented__track");
    expect(track?.style.getPropertyValue("--count")).toBe("3");
    expect(track?.style.getPropertyValue("--index")).toBe("2");
  });

  it("cannot be changed when disabled, and still shows the choice", async () => {
    const onChange = vi.fn();
    renderControl({ disabled: true, onChange, value: "ideas" });
    expect(screen.getByRole("radio", { name: "Get ideas" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Get ideas" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Find plot holes" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("hides the legend from the eye but not from screen readers when asked", () => {
    const { container } = renderControl({ hideLegend: true });
    expect(container.querySelector("legend")).toHaveClass("visually-hidden");
    expect(screen.getByRole("group", { name: "What do you want?" })).toBeInTheDocument();
  });

  it("keeps two controls on one page apart", () => {
    render(
      <>
        <SegmentedControl
          legend="One"
          options={OPTIONS}
          value="plot_holes"
          onChange={() => undefined}
        />
        <SegmentedControl legend="Two" options={OPTIONS} value="ideas" onChange={() => undefined} />
      </>,
    );
    const names = new Set(screen.getAllByRole("radio").map((radio) => radio.getAttribute("name")));
    expect(names.size).toBe(2);
  });

  it("has no accessibility violations", async () => {
    const { container } = renderControl();
    await expectNoA11yViolations(container);
  });

  describe("the hint of the chosen option", () => {
    const WITH_HINTS: readonly SegmentedOption<Mode>[] = [
      { value: "plot_holes", label: "Find plot holes", hint: "Points out contradictions." },
      { value: "ideas", label: "Get ideas", hint: "Suggests where the story could go." },
    ];

    it("shows the chosen option's hint under the control and ties it to the group", () => {
      render(
        <SegmentedControl<Mode>
          legend="What do you want?"
          options={WITH_HINTS}
          value="ideas"
          onChange={() => undefined}
        />,
      );
      const group = screen.getByRole("group", { name: "What do you want?" });
      expect(group).toHaveAccessibleDescription("Suggests where the story could go.");
      expect(screen.queryByText("Points out contradictions.")).not.toBeInTheDocument();
    });

    it("follows the choice", () => {
      const { rerender } = render(
        <SegmentedControl<Mode>
          legend="What do you want?"
          options={WITH_HINTS}
          value="plot_holes"
          onChange={() => undefined}
        />,
      );
      expect(screen.getByText("Points out contradictions.")).toBeInTheDocument();
      rerender(
        <SegmentedControl<Mode>
          legend="What do you want?"
          options={WITH_HINTS}
          value="ideas"
          onChange={() => undefined}
        />,
      );
      expect(screen.getByText("Suggests where the story could go.")).toBeInTheDocument();
      expect(screen.queryByText("Points out contradictions.")).not.toBeInTheDocument();
    });

    it("is not announced as the choice changes: it is not a live region", () => {
      render(
        <SegmentedControl<Mode>
          legend="What do you want?"
          options={WITH_HINTS}
          value="ideas"
          onChange={() => undefined}
        />,
      );
      expect(screen.getByText("Suggests where the story could go.")).not.toHaveAttribute("role");
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("shows nothing for an option without a hint, or for a value among no option", () => {
      const { container, rerender } = renderControl({ value: "plot_holes" });
      expect(container.querySelector(".segmented__hint")).toBeNull();
      expect(screen.getByRole("group")).not.toHaveAttribute("aria-describedby");
      rerender(
        <SegmentedControl<Mode>
          legend="What do you want?"
          options={WITH_HINTS}
          value="other"
          onChange={() => undefined}
        />,
      );
      expect(container.querySelector(".segmented__hint")).toBeNull();
    });

    it("shows the hint as plain text", () => {
      const { container } = render(
        <SegmentedControl<Mode>
          legend="What do you want?"
          options={[
            { value: "ideas", label: "Get ideas", hint: "<b>bold</b><script>x()</script>" },
          ]}
          value="ideas"
          onChange={() => undefined}
        />,
      );
      expect(container.querySelector("b, script")).toBeNull();
    });
  });
});
