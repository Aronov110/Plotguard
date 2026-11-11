import { describe, expect, it } from "vitest";
import tokensCss from "../tokens.css?raw";

/** Reads every `--name: #rrggbb;` of a piece of CSS. */
function readColors(css: string): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const match of css.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) colors[name] = value.toLowerCase();
  }
  return colors;
}

const [lightCss = "", darkCss = ""] = tokensCss.split("@media (prefers-color-scheme: dark)");
const light = readColors(lightCss);
const dark = { ...light, ...readColors(darkCss) };

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
  ["dark", dark],
] as const;

// [foreground, background, minimum ratio, why]
const PAIRS: readonly (readonly [string, string, number, string])[] = [
  ["color-text", "color-bg", 4.5, "body text on the page"],
  ["color-text", "color-surface", 4.5, "body text on a card"],
  ["color-text-muted", "color-bg", 4.5, "secondary text on the page"],
  ["color-text-muted", "color-surface", 4.5, "secondary text on a card"],
  ["color-accent", "color-bg", 4.5, "links and headings on the page"],
  ["color-accent", "color-surface", 4.5, "links and headings on a card"],
  ["color-on-accent", "color-accent", 4.5, "text on a primary button"],
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
    const darkOnly = readColors(darkCss);
    for (const name of Object.keys(light)) {
      expect(darkOnly[name], `${name} needs a dark value`).toBeDefined();
    }
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
});
