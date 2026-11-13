import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { THEME_STORAGE_KEY } from "../../../../lib/theme/theme.ts";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { ThemeSwitch } from "../ThemeSwitch.tsx";

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("ThemeSwitch", () => {
  it("is a group named for the colour theme, with system, light and dark", () => {
    render(<ThemeSwitch />);
    expect(screen.getByRole("group", { name: "Colour theme" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((radio) => radio.parentElement?.textContent)).toEqual([
      "System",
      "Light",
      "Dark",
    ]);
  });

  it("starts on system when nothing was chosen", () => {
    render(<ThemeSwitch />);
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
  });

  it("starts on the saved choice", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<ThemeSwitch />);
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("puts a chosen theme on the page and saves it", async () => {
    render(<ThemeSwitch />);
    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();

    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("goes back to the system's setting", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(<ThemeSwitch />);
    await userEvent.click(screen.getByRole("radio", { name: "System" }));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("can be used from the keyboard", async () => {
    render(<ThemeSwitch />);
    screen.getByRole("radio", { name: "System" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<ThemeSwitch />);
    await expectNoA11yViolations(container);
  });
});
