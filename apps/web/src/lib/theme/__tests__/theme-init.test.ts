import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyPreference, readPreference, THEME_STORAGE_KEY } from "../theme.ts";

// The script that runs before the first paint is plain JavaScript in public/, outside the app's code.
// These tests run it for real and make sure it does what the app's own code does.
// Vitest runs from apps/web, the folder that holds public/.
const script = readFileSync(join(process.cwd(), "public", "theme-init.js"), "utf8");

function runScript(stored: string | null, options: { blocked?: boolean } = {}): string | null {
  const root = document.createElement("html");
  const fakeWindow = {
    localStorage: {
      getItem: (key: string) => {
        if (options.blocked) throw new DOMException("denied", "SecurityError");
        return key === THEME_STORAGE_KEY ? stored : null;
      },
    },
  };
  new Function("window", "document", script)(fakeWindow, { documentElement: root });
  return root.getAttribute("data-theme");
}

function appResult(stored: string | null): string | null {
  const root = document.createElement("html");
  applyPreference(
    readPreference({ getItem: (key) => (key === THEME_STORAGE_KEY ? stored : null) }),
    root,
  );
  return root.getAttribute("data-theme");
}

describe("public/theme-init.js", () => {
  it.each([null, "system", "light", "dark", "bogus", "LIGHT", "", "constructor", "__proto__"])(
    "does what the app does for a saved value of %j",
    (stored) => {
      expect(runScript(stored)).toBe(appResult(stored));
    },
  );

  it("marks the page for a chosen theme and for nothing else", () => {
    expect(runScript("dark")).toBe("dark");
    expect(runScript("light")).toBe("light");
    expect(runScript("system")).toBeNull();
    expect(runScript(null)).toBeNull();
  });

  it("does not fail, and marks nothing, when the storage is blocked", () => {
    expect(runScript("dark", { blocked: true })).toBeNull();
  });

  it("uses the same storage key as the app", () => {
    expect(script).toContain(`"${THEME_STORAGE_KEY}"`);
  });

  it("is small and touches only the theme attribute", () => {
    expect(script.length).toBeLessThan(900);
    expect(script).not.toMatch(/innerHTML|eval\(|fetch|XMLHttpRequest|document\.write/);
    expect(script.match(/setAttribute\(/g)).toHaveLength(1);
  });
});
