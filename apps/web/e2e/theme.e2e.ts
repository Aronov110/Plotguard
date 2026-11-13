import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./support/axe.ts";

// The colour theme: it follows the system by default, can be set to light or dark, is saved in the
// browser, and is on the page before anything is painted.
const STORAGE_KEY = "plotpal-theme";
const LIGHT_BACKGROUND = "rgb(247, 242, 233)";
const DARK_BACKGROUND = "rgb(14, 17, 23)";

const backgroundOf = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const themeMark = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute("data-theme"));
const choice = (page: Page, name: "System" | "Light" | "Dark") => page.getByRole("radio", { name });

test.describe("following the system", () => {
  test.use({ colorScheme: "dark" });

  test("is dark when the system prefers dark, with nothing chosen", async ({ page }) => {
    await page.goto("/login");
    expect(await themeMark(page)).toBeNull();
    expect(await backgroundOf(page)).toBe(DARK_BACKGROUND);
    await expect(choice(page, "System")).toBeChecked();
  });
});

test.describe("following a light system", () => {
  test.use({ colorScheme: "light" });

  test("is light when the system prefers light, with nothing chosen", async ({ page }) => {
    await page.goto("/login");
    expect(await themeMark(page)).toBeNull();
    expect(await backgroundOf(page)).toBe(LIGHT_BACKGROUND);
  });

  test("a chosen dark theme beats the system, and is saved as one word", async ({ page }) => {
    await page.goto("/login");
    await choice(page, "Dark").check();
    expect(await themeMark(page)).toBe("dark");
    expect(await backgroundOf(page)).toBe(DARK_BACKGROUND);
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe("dark");
    expect(await page.evaluate(() => localStorage.length)).toBe(1);
  });

  test("the choice survives a reload and is on the page before it is painted", async ({ page }) => {
    await page.addInitScript(() => {
      // Records whether the page body existed yet at the moment the theme was put on the page.
      const seen: { bodyExisted: boolean | undefined } = { bodyExisted: undefined };
      (window as unknown as { __themeSeen: typeof seen }).__themeSeen = seen;
      new MutationObserver(() => {
        if (seen.bodyExisted === undefined && document.documentElement.hasAttribute("data-theme")) {
          seen.bodyExisted = document.body !== null;
        }
        // The root element does not exist yet when this runs, so the whole document is watched.
      }).observe(document, { attributes: true, subtree: true });
    });
    await page.goto("/login");
    await choice(page, "Dark").check();

    await page.reload();
    expect(await themeMark(page)).toBe("dark");
    expect(await backgroundOf(page)).toBe(DARK_BACKGROUND);
    const seen = await page.evaluate(
      () =>
        (window as unknown as { __themeSeen: { bodyExisted: boolean | undefined } }).__themeSeen,
    );
    // The early script runs in the head, before the body is parsed: no flash of the wrong colours.
    expect(seen.bodyExisted).toBe(false);
  });

  test("going back to System removes the mark and the saved word", async ({ page }) => {
    await page.goto("/login");
    await choice(page, "Dark").check();
    await choice(page, "System").check();
    expect(await themeMark(page)).toBeNull();
    expect(await backgroundOf(page)).toBe(LIGHT_BACKGROUND);
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull();
  });

  test("a saved word that means nothing is ignored", async ({ page }) => {
    await page.addInitScript((key) => {
      localStorage.setItem(key, "purple");
    }, STORAGE_KEY);
    await page.goto("/login");
    expect(await themeMark(page)).toBeNull();
    await expect(choice(page, "System")).toBeChecked();
  });

  test("works from the keyboard", async ({ page }) => {
    await page.goto("/login");
    await choice(page, "System").focus();
    await page.keyboard.press("ArrowRight");
    await expect(choice(page, "Light")).toBeChecked();
    await page.keyboard.press("ArrowRight");
    await expect(choice(page, "Dark")).toBeChecked();
    expect(await themeMark(page)).toBe("dark");
  });

  test("the home page has the choice too", async ({ page }) => {
    await page.goto("/");
    await choice(page, "Dark").check();
    expect(await themeMark(page)).toBe("dark");
  });
});

// Each combination of the system's setting and a chosen theme must pass the colour checks.
for (const system of ["light", "dark"] as const) {
  for (const chosen of ["System", "Light", "Dark"] as const) {
    test.describe(`axe with a ${system} system and ${chosen} chosen (colour contrast included)`, () => {
      test.use({ colorScheme: system });

      test("the login screen", async ({ page }) => {
        await page.goto("/login");
        await choice(page, chosen).check();
        await expectNoAxeViolations(page);
      });

      test("the home page", async ({ page }) => {
        await page.goto("/");
        await choice(page, chosen).check();
        await expectNoAxeViolations(page);
      });
    });
  }
}
