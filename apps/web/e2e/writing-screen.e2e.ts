import { expect, type Page, test } from "@playwright/test";
import {
  aiNext,
  createAccount,
  createProjectWithDocuments,
  releaseAi,
} from "./support/api-control.ts";
import { expectNoAxeViolations } from "./support/axe.ts";
import { logIn } from "./support/flows.ts";
import { uniqueUser } from "./support/users.ts";

// The writing screen: a bar with an Outline button and an AI assistant button, the outline panel on
// the left, the text in the middle and the AI drawer on the right (below the text on a narrow screen).
const RESULT_TIMEOUT = 20_000;

const outlineButton = (page: Page) => page.getByRole("button", { name: "Outline", exact: true });
const aiButton = (page: Page) => page.getByRole("button", { name: "AI assistant", exact: true });
const drawer = (page: Page) => page.getByRole("complementary", { name: "AI assistant" });
const textBox = (page: Page) => page.getByRole("textbox", { name: "Text of “The Storm”" });

async function openStory(page: Page, request: Parameters<typeof createAccount>[0]) {
  const user = uniqueUser();
  await createAccount(request, user);
  const seeded = await createProjectWithDocuments(request, user, {
    title: "The Lighthouse",
    documents: [
      { title: "Act One", content: "The lighthouse stands alone." },
      { title: "The Storm", inside: "Act One", content: "Waves crash on the rocks." },
    ],
  });
  await page.goto("/login");
  await logIn(page, user);
  await page.goto(`/app/projects/${seeded.projectId}?document=${seeded.ids["The Storm"]}`);
  await expect(page.getByRole("heading", { level: 1, name: "The Lighthouse" })).toBeVisible();
  await expect(textBox(page)).toBeVisible();
  return seeded;
}

const widthOf = (page: Page) =>
  textBox(page).evaluate((element) => element.getBoundingClientRect().width);

test.describe("on a wide screen", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.afterEach(async ({ request }) => {
    await releaseAi(request);
  });

  test("starts with the outline open and the AI drawer closed", async ({ page, request }) => {
    await openStory(page, request);
    await expect(outlineButton(page)).toHaveAttribute("aria-expanded", "true");
    await expect(aiButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("navigation", { name: "Outline" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Run the scan" })).toBeHidden();
  });

  test("the outline closes and opens, and the text takes the room", async ({ page, request }) => {
    await openStory(page, request);
    const narrow = await widthOf(page);

    await outlineButton(page).click();
    await expect(outlineButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("navigation", { name: "Outline" })).toBeHidden();
    await expect.poll(() => widthOf(page)).toBeGreaterThan(narrow + 100);

    await outlineButton(page).click();
    await expect(page.getByRole("navigation", { name: "Outline" })).toBeVisible();
    await expect.poll(() => widthOf(page)).toBeLessThan(narrow + 5);
  });

  test("the AI drawer opens beside the text and takes the focus to its heading", async ({
    page,
    request,
  }) => {
    await openStory(page, request);
    const before = await widthOf(page);
    await aiButton(page).click();

    await expect(aiButton(page)).toHaveAttribute("aria-expanded", "true");
    await expect(drawer(page)).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "AI assistant" })).toBeFocused();
    await expect(page.getByRole("button", { name: "Run the scan" })).toBeVisible();
    await expect.poll(() => widthOf(page)).toBeLessThan(before - 100);
  });

  test("Escape from inside the drawer closes it and gives the focus back to its button", async ({
    page,
    request,
  }) => {
    await openStory(page, request);
    await aiButton(page).click();
    await page.getByRole("button", { name: "Run the scan" }).focus();
    await page.keyboard.press("Escape");

    await expect(aiButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(drawer(page)).toBeHidden();
    await expect(aiButton(page)).toBeFocused();
  });

  test("the Close button closes it too", async ({ page, request }) => {
    await openStory(page, request);
    await aiButton(page).click();
    await page.getByRole("button", { name: "Close the panel" }).click();
    await expect(drawer(page)).toBeHidden();
    await expect(aiButton(page)).toBeFocused();
  });

  test("Escape in the writing text leaves the drawer alone", async ({ page, request }) => {
    await openStory(page, request);
    await aiButton(page).click();
    await textBox(page).focus();
    await page.keyboard.press("Escape");
    await expect(aiButton(page)).toHaveAttribute("aria-expanded", "true");
  });

  test("what is closed cannot be tabbed to", async ({ page, request }) => {
    await openStory(page, request);
    await aiButton(page).click();
    await page.getByRole("button", { name: "Close the panel" }).click();
    await outlineButton(page).click();

    // Walk the whole page by keyboard: nothing inside the closed panels is reached.
    const reached = new Set<string>();
    await aiButton(page).focus();
    for (let step = 0; step < 40; step++) {
      await page.keyboard.press("Tab");
      reached.add(
        await page.evaluate(() => document.activeElement?.closest("aside, nav")?.tagName ?? ""),
      );
    }
    expect(reached.has("ASIDE")).toBe(false);
    expect(reached.has("NAV")).toBe(false);
  });

  test("a run goes on while the drawer is closed, and is there when it is opened again", async ({
    page,
    request,
  }) => {
    await openStory(page, request);
    await aiNext(request, "hold");
    await aiButton(page).click();
    await page.getByRole("button", { name: "Run the scan" }).click();
    await expect(page.getByRole("progressbar")).toBeVisible();

    await page.getByRole("button", { name: "Close the panel" }).click();
    await expect(drawer(page)).toBeHidden();
    await releaseAi(request);

    await aiButton(page).click();
    await expect(page.getByRole("list", { name: "Findings" })).toBeVisible({
      timeout: RESULT_TIMEOUT,
    });
  });

  test("works from the keyboard", async ({ page, request }) => {
    await openStory(page, request);
    await aiButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(drawer(page)).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Close the panel" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(drawer(page)).toBeHidden();
    await expect(aiButton(page)).toBeFocused();
  });

  test("the save pill says Saving and then Saved in words", async ({ page, request }) => {
    await openStory(page, request);
    await textBox(page).fill("Waves crash on the rocks, again and again.");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("the drawer opens under the text and nothing scrolls sideways", async ({
    page,
    request,
  }) => {
    await openStory(page, request);
    await aiButton(page).click();
    await expect(drawer(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Run the scan" })).toBeVisible();

    const box = await drawer(page).boundingBox();
    const text = await textBox(page).boundingBox();
    expect(box?.y ?? 0).toBeGreaterThan((text?.y ?? 0) + (text?.height ?? 0) - 1);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("both panels closed, and both open, fit the screen", async ({ page, request }) => {
    await openStory(page, request);
    for (const open of [false, true]) {
      if (open) {
        await aiButton(page).click();
        await expect(drawer(page)).toBeVisible();
      } else {
        await outlineButton(page).click();
        await expect(page.getByRole("navigation", { name: "Outline" })).toBeHidden();
        await outlineButton(page).click();
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });
});

test.describe("with reduced motion", () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });

  test("nothing slides or fades", async ({ page, request }) => {
    await openStory(page, request);
    const seconds = await page.evaluate(() => {
      const longest = (element: Element | null): number =>
        element === null
          ? 0
          : Math.max(
              ...getComputedStyle(element)
                .transitionDuration.split(",")
                .map((value) => Number.parseFloat(value)),
            );
      return [
        longest(document.querySelector(".writing-page__panes")),
        longest(document.querySelector(".button")),
        longest(document.querySelector(".segmented__thumb")),
      ];
    });
    for (const value of seconds) expect(value).toBeLessThan(0.001);
  });
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`axe on the writing screen in ${colorScheme} mode (colour contrast included)`, () => {
    test.use({ colorScheme, viewport: { width: 1440, height: 900 } });

    test.afterEach(async ({ request }) => {
      await releaseAi(request);
    });

    test("with the outline open and the drawer closed, then with the drawer open", async ({
      page,
      request,
    }) => {
      await openStory(page, request);
      await expectNoAxeViolations(page);

      await aiButton(page).click();
      await expect(page.getByRole("button", { name: "Run the scan" })).toBeVisible();
      await page.waitForTimeout(700);
      await expectNoAxeViolations(page);
    });

    test("with the outline closed and an AI result shown", async ({ page, request }) => {
      await openStory(page, request);
      await outlineButton(page).click();
      await aiButton(page).click();
      await page.getByRole("button", { name: "Run the scan" }).click();
      await expect(page.getByRole("list", { name: "Findings" })).toBeVisible({
        timeout: RESULT_TIMEOUT,
      });
      await page.waitForTimeout(700);
      await expectNoAxeViolations(page);
    });
  });
}

test.describe("axe on a phone", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("with the drawer open", async ({ page, request }) => {
    await openStory(page, request);
    await aiButton(page).click();
    await expect(page.getByRole("button", { name: "Run the scan" })).toBeVisible();
    await page.waitForTimeout(700);
    await expectNoAxeViolations(page);
  });
});
