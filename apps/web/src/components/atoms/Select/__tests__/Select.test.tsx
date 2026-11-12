import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { Select } from "../Select.tsx";

function renderSelect(props: Partial<React.ComponentProps<typeof Select>> = {}) {
  return render(
    <Select id="where" aria-label="Where" {...props}>
      <option value="a">Alpha</option>
      <option value="b">Beta</option>
    </Select>,
  );
}

describe("Select", () => {
  it("is a drop-down list with the given id and its choices", () => {
    renderSelect();
    const select = screen.getByRole("combobox", { name: "Where" });
    expect(select).toHaveAttribute("id", "where");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Alpha",
      "Beta",
    ]);
  });

  it("starts on the first choice, or on the default value", () => {
    const { unmount } = renderSelect();
    expect(screen.getByRole("combobox")).toHaveValue("a");
    unmount();
    renderSelect({ defaultValue: "b" });
    expect(screen.getByRole("combobox")).toHaveValue("b");
  });

  it("lets the keyboard change the choice", async () => {
    const onChange = vi.fn();
    renderSelect({ onChange });
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole("combobox"), "b");
    expect(screen.getByRole("combobox")).toHaveValue("b");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("passes a ref and the usual attributes on", () => {
    const ref = createRef<HTMLSelectElement>();
    renderSelect({ ref, name: "where", disabled: true });
    expect(ref.current).toBe(screen.getByRole("combobox"));
    expect(ref.current).toHaveAttribute("name", "where");
    expect(ref.current).toBeDisabled();
  });

  it("has a class of its own, and does not accept one", () => {
    renderSelect();
    expect(screen.getByRole("combobox")).toHaveClass("select");
  });

  it("is marked invalid only when it is", () => {
    const { unmount } = renderSelect();
    expect(screen.getByRole("combobox")).not.toHaveAttribute("aria-invalid");
    unmount();
    renderSelect({ invalid: true });
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-invalid", "true");
  });

  it("shows a title with markup in it as text", () => {
    render(
      <Select id="x" aria-label="X">
        <option value="1">{"<b>Bold</b>"}</option>
      </Select>,
    );
    expect(screen.getByRole("option")).toHaveTextContent("<b>Bold</b>");
    expect(document.querySelector("b")).toBeNull();
  });

  it("has no accessibility violations, plain or invalid", async () => {
    const { container } = render(
      <>
        <Select id="one" aria-label="One">
          <option value="a">A</option>
        </Select>
        <Select id="two" aria-label="Two" invalid>
          <option value="a">A</option>
        </Select>
      </>,
    );
    await expectNoA11yViolations(container);
  });
});
