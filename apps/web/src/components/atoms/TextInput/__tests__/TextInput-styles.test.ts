import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest blanks CSS files other than tokens.css (jsdom does no layout), so the file is read directly.
const css = readFileSync(
  join(process.cwd(), "src", "components", "atoms", "TextInput", "TextInput.css"),
  "utf8",
);

// jsdom does no layout and loads no CSS, so these read the stylesheet that the text input, the text
// area and the select share, and check the rules that keep it accessible and themed.
describe("the shared field stylesheet", () => {
  it("styles all three fields, so that they cannot drift apart", () => {
    for (const selector of [".text-input", ".text-area", ".select"]) {
      expect(css).toContain(selector);
    }
  });

  it("uses only the theme's colours, never a colour of its own", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
  });

  it("keeps a strong 2px edge, which is what shows where the field is (WCAG 1.4.11)", () => {
    expect(css).toMatch(/border:\s*2px solid var\(--color-border\)/);
  });

  it("marks hover, focus and an invalid value", () => {
    expect(css).toContain(":hover");
    expect(css).toContain(":focus-visible");
    expect(css).toContain('[aria-invalid="true"]');
    expect(css).toContain("var(--color-danger)");
  });

  it("repaints an autofilled field in the theme's colours, in both browsers' syntax", () => {
    // The rule itself (both syntaxes together, then its text colour and its inset shadow), not just
    // the words somewhere in the file.
    expect(css).toMatch(
      /\.text-input:-webkit-autofill,\s*\.text-input:autofill\s*\{[^}]*-webkit-text-fill-color:\s*var\(--color-text\)[^}]*inset/,
    );
  });

  it("is at least 44 px tall", () => {
    expect(css).toContain("min-height: var(--size-target)");
  });

  it("does not let a text area grow wider than the screen", () => {
    expect(css).toMatch(/\.text-area\s*\{[^}]*resize:\s*vertical/);
  });

  it("moves only through the motion tokens, which reduced motion switches off", () => {
    expect(css).not.toMatch(/transition:[^;]*\b\d+(\.\d+)?m?s\b/);
    expect(css).toContain("var(--duration-");
  });
});
