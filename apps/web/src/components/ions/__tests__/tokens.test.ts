import { describe, expect, it } from "vitest";
import tokensCss from "../tokens.css?raw";

/** Reads every `--name: #rrggbb;` of a piece of CSS. */
function readColors(css: string): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const match of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) colors[name] = value.toLowerCase();
  }
  return colors;
}

/** Every declaration of a block (`--token` and plain properties such as `color-scheme`), without comments. */
function readDeclarations(block: string): Record<string, string> {
  const declarations: Record<string, string> = {};
  for (const match of block
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .matchAll(/([a-z0-9-]+):\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) declarations[name] = value.trim();
  }
  return declarations;
}

function blockOf(pattern: RegExp, what: string): string {
  const match = pattern.exec(tokensCss);
  expect(match, `${what} must exist in tokens.css`).not.toBeNull();
  return match?.[1] ?? "";
}

// Three blocks hold the colours: the light ones, the dark ones for a system that prefers dark (unless
// the person chose light), and the dark ones for a person who chose dark.
const lightBlock = blockOf(/:root\s*\{([^}]*)\}/, "the light block");
const systemDarkBlock = blockOf(
  /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/,
  "the system dark block",
);
const chosenDarkBlock = blockOf(
  /:root\[data-theme="dark"\]\s*\{([^}]*)\}/,
  "the chosen dark block",
);
const chosenLightBlock = blockOf(
  /:root\[data-theme="light"\]\s*\{([^}]*)\}/,
  "the chosen light block",
);

const light = readColors(lightBlock);
const dark = { ...light, ...readColors(systemDarkBlock) };
const chosenDark = { ...light, ...readColors(chosenDarkBlock) };

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio of two colors, from 1 (identical) to 21 (black on white). */
function contrast(first: string, second: string): number {
  const [lighter = 0, darker = 0] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const THEMES = [
  ["light", light],
  ["dark (the system prefers it)", dark],
  ["dark (the person chose it)", chosenDark],
] as const;

// [foreground, background, minimum ratio, why]
const PAIRS: readonly (readonly [string, string, number, string])[] = [
  ["color-text", "color-bg", 4.5, "body text on the page"],
  ["color-text", "color-surface", 4.5, "body text on a card"],
  ["color-text", "color-surface-2", 4.5, "body text on a raised or tinted area"],
  ["color-text-muted", "color-bg", 4.5, "secondary text on the page"],
  ["color-text-muted", "color-surface", 4.5, "secondary text on a card"],
  ["color-text-muted", "color-surface-2", 4.5, "secondary text on a raised or tinted area"],
  ["color-accent", "color-bg", 4.5, "links and headings on the page"],
  ["color-accent", "color-surface", 4.5, "links and headings on a card"],
  ["color-accent-strong", "color-bg", 4.5, "stronger links on the page"],
  ["color-accent-strong", "color-surface", 4.5, "stronger links on a card"],
  [
    "color-accent-strong",
    "color-accent-soft",
    4.5,
    "text on a tinted accent area (a selected item)",
  ],
  ["color-text", "color-accent-soft", 4.5, "normal text on a tinted accent area"],
  [
    "color-text-muted",
    "color-accent-soft",
    4.5,
    "secondary text on a tinted accent area (a chosen card)",
  ],
  [
    "color-accent-strong",
    "color-surface-2",
    4.5,
    "stronger accent text on a raised or tinted area",
  ],
  ["color-on-accent", "color-accent", 4.5, "text on a primary button"],
  ["color-on-accent", "color-accent-strong", 4.5, "text on a primary button under the pointer"],
  ["color-accent", "color-accent-soft", 4.5, "text on a secondary button under the pointer"],
  ["color-on-danger", "color-danger", 4.5, "text on a delete button"],
  ["color-danger", "color-bg", 4.5, "error text on the page"],
  ["color-danger", "color-surface", 4.5, "error text on a card"],
  ["color-danger", "color-danger-bg", 4.5, "error text in an error box"],
  ["color-text", "color-danger-bg", 4.5, "normal text in an error box"],
  ["color-success", "color-bg", 4.5, "success text on the page"],
  ["color-success", "color-surface", 4.5, "success text on a card"],
  ["color-success", "color-success-bg", 4.5, "success text in a success box"],
  ["color-text", "color-success-bg", 4.5, "normal text in a success box"],
  ["color-border", "color-bg", 3, "the edge of a field on the page (WCAG 1.4.11)"],
  ["color-border", "color-surface", 3, "the edge of a field on a card (WCAG 1.4.11)"],
  ["color-focus", "color-bg", 3, "the focus ring on the page (WCAG 2.4.11)"],
  ["color-focus", "color-surface", 3, "the focus ring on a card (WCAG 2.4.11)"],
  ["color-focus", "color-surface-2", 3, "the focus ring on a raised or tinted area"],
  ["color-accent", "color-surface-2", 3, "the accent as a graphic on a raised area (WCAG 1.4.11)"],
];

describe("design tokens", () => {
  describe.each(THEMES)("%s theme", (_name, theme) => {
    it.each(PAIRS)("%s on %s is at least %s:1 (%s)", (foreground, background, minimum) => {
      const front = theme[foreground];
      const back = theme[background];
      expect(front, `${foreground} must be defined`).toBeDefined();
      expect(back, `${background} must be defined`).toBeDefined();
      expect(contrast(front ?? "#000000", back ?? "#ffffff")).toBeGreaterThanOrEqual(minimum);
    });
  });

  it("gives the dark theme its own value for every color, so no light color leaks in", () => {
    const darkOnly = readColors(systemDarkBlock);
    for (const name of Object.keys(light)) {
      expect(darkOnly[name], `${name} needs a dark value`).toBeDefined();
    }
  });

  it("keeps the two dark blocks identical, so the theme a person chose looks like the system's", () => {
    expect(readDeclarations(chosenDarkBlock)).toEqual(readDeclarations(systemDarkBlock));
  });

  it("tells browsers which scheme is in use, so controls and scrollbars match", () => {
    expect(readDeclarations(lightBlock)["color-scheme"]).toBe("light dark");
    expect(readDeclarations(chosenLightBlock)["color-scheme"]).toBe("light");
    expect(readDeclarations(chosenDarkBlock)["color-scheme"]).toBe("dark");
    expect(readDeclarations(systemDarkBlock)["color-scheme"]).toBe("dark");
  });

  it("keeps the soft divider colour out of anything that must be seen (it is decoration only)", () => {
    // The dividers are very faint on purpose; they must never be used as the edge of a field.
    expect(
      contrast(light["color-divider"] ?? "#000000", light["color-surface"] ?? "#ffffff"),
    ).toBeLessThan(3);
    expect(tokensCss).toContain("--color-divider");
  });

  it("defines the motion, depth and shape tokens the components read", () => {
    const names = Object.keys(readDeclarations(lightBlock));
    for (const token of [
      "--shadow-1",
      "--shadow-2",
      "--radius-1",
      "--radius-2",
      "--ease-out",
      "--duration-fast",
      "--duration-medium",
      "--duration-slow",
      "--font-ui",
      "--font-head",
      "--font-writing",
    ]) {
      expect(names, `${token} must be defined`).toContain(token);
    }
  });

  it("gives the dark theme its own shadows, which are darker", () => {
    expect(readDeclarations(systemDarkBlock)["--shadow-1"]).toBeDefined();
    expect(readDeclarations(systemDarkBlock)["--shadow-2"]).toBeDefined();
  });

  it("measures contrast the way WCAG does", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrast("#777777", "#777777")).toBeCloseTo(1, 5);
  });

  it("keeps clickable things at least 24 CSS pixels tall, as WCAG 2.5.8 demands", () => {
    const match = /--size-target:\s*([\d.]+)rem/.exec(tokensCss);
    expect(match).not.toBeNull();
    expect(Number(match?.[1]) * 16).toBeGreaterThanOrEqual(24);
  });

  it("offers a class that hides text visually but not from screen readers", () => {
    expect(tokensCss).toMatch(/\.visually-hidden\s*\{/);
  });

  it("stops motion for people who ask for less of it", () => {
    expect(tokensCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
});
