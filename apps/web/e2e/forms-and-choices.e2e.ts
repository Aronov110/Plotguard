import { expect, type Page, test } from "@playwright/test";
import { createAccount, createProjectWithDocuments, releaseAi } from "./support/api-control.ts";
import { expectNoAxeViolations } from "./support/axe.ts";
import { logIn } from "./support/flows.ts";
import { uniqueUser } from "./support/users.ts";

// The fields, the show-password button joined to its field, the choice cards and the sliding mode
// control: how they behave in a real browser, where the page's own CSS is in force.

const showPassword = (page: Page) => page.getByRole("button", { name: "Show password" });
/** Presses the mouse in the middle of an element, as a person would, wherever it lands. Playwright's own
 *  click refuses an element that something see-through covers, which is exactly what the page does. */
async function pressMiddleOf(page: Page, locator: ReturnType<Page["locator"]>): Promise<void> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("The element is not on the screen.");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("the login form", () => {
  test("has an icon in each field, and the icons take no clicks", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator(".form-field__icon svg")).toHaveCount(2);
    // A click on the icon lands in the field.
    await pressMiddleOf(page, page.locator(".form-field__icon").first());
    await expect(page.getByLabel("Email")).toBeFocused();
  });

  test("the eye button is joined to the field and shows and hides the password", async ({
    page,
  }) => {
    await page.goto("/login");
    const field = page.getByLabel("Password", { exact: true });
    await field.fill("  a secret with spaces  ");
    await expect(field).toHaveAttribute("type", "password");

    const toggle = showPassword(page);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(field).toHaveAttribute("type", "text");
    await expect(field).toHaveValue("  a secret with spaces  ");
    await toggle.click();
    await expect(field).toHaveAttribute("type", "password");

    // Side by side and the same height: one joined control.
    const [box, button] = await Promise.all([field.boundingBox(), toggle.boundingBox()]);
    expect(Math.abs((box?.y ?? 0) - (button?.y ?? 1))).toBeLessThan(2);
    expect(Math.abs((box?.height ?? 0) - (button?.height ?? 1))).toBeLessThan(2);
    expect(button?.x ?? 0).toBeGreaterThan((box?.x ?? 0) + (box?.width ?? 0) - 6);
  });

  test("the eye button works from the keyboard and never submits the form", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Password", { exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(showPassword(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(showPassword(page)).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Space");
    await expect(showPassword(page)).toHaveAttribute("aria-pressed", "false");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("an empty submit shows the summary and the field errors, tied to their fields", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("alert")).toBeFocused();
    const email = page.getByLabel("Email");
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Enter your email address.").last()).toBeVisible();
    await expect(email).toHaveAccessibleDescription(/Enter your email address/);
  });

  test("the field shows where the focus is, with a halo and a ring", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").focus();
    const style = await page.getByLabel("Email").evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        outlineWidth: Number.parseFloat(computed.outlineWidth),
        outlineStyle: computed.outlineStyle,
        boxShadow: computed.boxShadow,
      };
    });
    expect(style.outlineStyle).not.toBe("none");
    expect(style.outlineWidth).toBeGreaterThanOrEqual(2);
    expect(style.boxShadow).not.toBe("none");
  });

  test("fits a phone screen, eye button included", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/login");
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
    const box = await showPassword(page).boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  test("the error slides in, and not at all with reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/login");
    await page.getByRole("button", { name: "Log in" }).click();
    const seconds = await page
      .locator(".inline-error")
      .first()
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).animationDuration));
    expect(seconds).toBeLessThan(0.001);
  });
});

test.describe("the sign-up form", () => {
  test("has three icons and the eye button", async ({ page }) => {
    await page.goto("/register");
    await expect(page.locator(".form-field__icon svg")).toHaveCount(3);
    await expect(showPassword(page)).toBeVisible();
  });
});

test.describe("the choices on the writing screen", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.afterEach(async ({ request }) => {
    await releaseAi(request);
  });

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
  }

  test("a press anywhere on a card chooses it, hint text included", async ({ page, request }) => {
    await openStory(page, request);
    const scene = page.getByRole("radio", { name: "Inside “Act One”" });
    const top = page.getByRole("radio", { name: "At the top level" });
    await expect(scene).toBeChecked();
    await pressMiddleOf(page, page.getByText("An act or a chapter."));
    await expect(top).toBeChecked();
    await pressMiddleOf(page, page.getByText("A scene."));
    await expect(scene).toBeChecked();
  });

  test("the chosen card has a tick, and the others do not show one", async ({ page, request }) => {
    await openStory(page, request);
    const ticks = page.locator(".choice-option__tick");
    const colours = await ticks.evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).backgroundColor),
    );
    // The chosen card's ring is filled; the other is not.
    expect(colours[0]).not.toBe(colours[1]);
  });

  test("the arrow keys move the choice within a group of cards", async ({ page, request }) => {
    await openStory(page, request);
    await page.getByRole("radio", { name: "Inside “Act One”" }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio", { name: "At the top level" })).toBeChecked();
  });

  test("the mode control slides, shows the explanation of the choice and moves with arrow keys", async ({
    page,
    request,
  }) => {
    await openStory(page, request);
    await page.getByRole("button", { name: "AI assistant", exact: true }).click();
    const plot = page.getByRole("radio", { name: "Find plot holes" });
    const ideas = page.getByRole("radio", { name: "Get ideas" });
    await expect(plot).toBeChecked();
    await expect(
      page.getByText(/contradicts itself or leaves something unexplained\.$/),
    ).toBeVisible();

    const group = page.getByRole("group", { name: "What do you want?" });
    const thumb = group.locator(".segmented__thumb");
    // Where the marker is inside its own control (the drawer may still be sliding open, which moves
    // everything on the page, so the position on the page says nothing).
    const offset = async (): Promise<number> => {
      const [marker, box] = await Promise.all([thumb.boundingBox(), group.boundingBox()]);
      return (marker?.x ?? 0) - (box?.x ?? 0);
    };
    await expect.poll(offset).toBeLessThan(10);
    await ideas.click();
    await expect(ideas).toBeChecked();
    await expect(page.getByText(/They are suggestions, not corrections\./)).toBeVisible();
    await expect.poll(offset).toBeGreaterThan(40);

    await ideas.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(plot).toBeChecked();
  });

  test("the mode and scope choices are locked while a run goes", async ({ page, request }) => {
    await openStory(page, request);
    await page.getByRole("button", { name: "AI assistant", exact: true }).click();
    await page.getByRole("button", { name: "Run the scan" }).click();
    await expect(page.getByRole("progressbar")).toBeVisible();
    await expect(page.getByRole("radio", { name: "Get ideas" })).toBeDisabled();
    await expect(page.getByRole("radio", { name: "The whole project" })).toBeDisabled();
  });

  test("fits a phone screen with the drawer open", async ({ page, request }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openStory(page, request);
    await page.getByRole("button", { name: "AI assistant", exact: true }).click();
    await expect(page.getByRole("radio", { name: "Get ideas" })).toBeVisible();
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
  });
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`axe on forms and choices in ${colorScheme} mode (colour contrast included)`, () => {
    test.use({ colorScheme });

    test("the login form with errors and the password shown", async ({ page }) => {
      await page.goto("/login");
      await page.getByRole("button", { name: "Log in" }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      await showPassword(page).click();
      await page.waitForTimeout(400);
      await expectNoAxeViolations(page);
    });

    test("the sign-up form", async ({ page }) => {
      await page.goto("/register");
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      await page.waitForTimeout(400);
      await expectNoAxeViolations(page);
    });

    test("the writing screen with the cards and the mode control", async ({ page, request }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const user = uniqueUser();
      await createAccount(request, user);
      const seeded = await createProjectWithDocuments(request, user, {
        title: "The Lighthouse",
        documents: [
          { title: "Act One", content: "One." },
          { title: "The Storm", inside: "Act One", content: "Two." },
        ],
      });
      await page.goto("/login");
      await logIn(page, user);
      await page.goto(`/app/projects/${seeded.projectId}?document=${seeded.ids["The Storm"]}`);
      await page.getByRole("button", { name: "AI assistant", exact: true }).click();
      await page.getByRole("radio", { name: "Get ideas" }).check();
      await page.waitForTimeout(700);
      await expectNoAxeViolations(page);
    });
  });
}
