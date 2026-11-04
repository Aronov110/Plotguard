import { expect, type Locator, test } from "@playwright/test";
import { createAccount } from "./support/api-control.ts";
import { PROJECTS_HEADING, signUp } from "./support/flows.ts";
import { uniqueUser } from "./support/users.ts";

// Safari, and so Playwright's WebKit, does not stop on links when Tab is pressed: people turn on
// "Press Tab to highlight each item" or hold Option. Fields and buttons work. Measured on this
// setup: Tab and Alt+Tab both go email, password, Show password, Log in, and then leave the page,
// never touching the link. So in WebKit the links are left out of the Tab sequences below, and the
// skip link (a link) is tested in Chromium only. The unit tests cover what the link does.
const WEBKIT_NO_LINK_TABBING = "WebKit does not Tab to links (the Safari default).";

/** True when something on the screen shows that the element has the keyboard focus. */
async function showsFocusRing(element: Locator): Promise<boolean> {
  return element.evaluate((node) => {
    const style = getComputedStyle(node);
    const outline = style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0;
    return outline || style.boxShadow !== "none";
  });
}

/** True when the element is the topmost thing at its own centre, so nothing covers it. */
async function isNotCovered(element: Locator): Promise<boolean> {
  return element.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return top === node || node.contains(top);
  });
}

test.describe("using only the keyboard", () => {
  test("a person can log in without a mouse, with Enter sending the form", async ({
    page,
    request,
  }) => {
    const user = uniqueUser();
    await createAccount(request, user);

    await page.goto("/login");
    await page.getByLabel("Email").focus();
    await page.keyboard.type(user.email);
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
    await page.keyboard.type(user.password);
    await page.keyboard.press("Enter");

    await expect(page.getByRole("heading", PROJECTS_HEADING)).toBeVisible();
  });

  test("the tab order on the login screen follows the visual order", async ({
    page,
    browserName,
  }) => {
    await page.goto("/login");
    const order = [
      page.getByLabel("Email"),
      page.getByLabel("Password", { exact: true }),
      page.getByRole("button", { name: "Show password" }),
      page.getByRole("button", { name: "Log in" }),
      ...(browserName === "webkit" ? [] : [page.getByRole("link", { name: "Create one" })]),
    ];
    await page.getByLabel("Email").focus();
    for (const [index, element] of order.entries()) {
      await expect(element).toBeFocused();
      if (index < order.length - 1) await page.keyboard.press("Tab");
    }
  });

  test("the password can be shown with the space bar", async ({ page }) => {
    await page.goto("/login");
    const toggle = page.getByRole("button", { name: "Show password" });
    await toggle.focus();
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).toBeFocused();
  });

  test("the first Tab on the signed-in home reaches the skip link, and it jumps to the content", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName === "webkit", WEBKIT_NO_LINK_TABBING);
    await signUp(page, uniqueUser());
    await page.reload();
    await expect(page.getByRole("heading", PROJECTS_HEADING)).toBeVisible();

    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();

    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
    await expect(page).toHaveURL(/\/app$/);
  });
});

test.describe("where the focus goes", () => {
  test("after a failed submit it moves to the error summary", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("alert")).toBeFocused();
  });

  test("after moving to another screen it moves to that screen's heading", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Create one" }).click();
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();

    await page.getByRole("link", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  });

  test("after signing up it moves to the heading of the signed-in home", async ({ page }) => {
    await signUp(page, uniqueUser());
    await expect(page.getByRole("heading", PROJECTS_HEADING)).toBeFocused();
  });

  test("a fresh page load does not steal the focus", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1 })).not.toBeFocused();
  });
});

test.describe("the focus ring", () => {
  test("is visible on every control of the login screen when reached with the keyboard", async ({
    page,
    browserName,
  }) => {
    await page.goto("/login");
    // Start on the first field: where the very first Tab goes from a fresh page differs by browser.
    await page.getByLabel("Email").focus();
    for (const [index, control] of [
      page.getByLabel("Email"),
      page.getByLabel("Password", { exact: true }),
      page.getByRole("button", { name: "Show password" }),
      page.getByRole("button", { name: "Log in" }),
      ...(browserName === "webkit" ? [] : [page.getByRole("link", { name: "Create one" })]),
    ].entries()) {
      if (index > 0) await page.keyboard.press("Tab");
      await expect(control).toBeFocused();
      expect(await showsFocusRing(control)).toBe(true);
    }
  });

  test("is not covered by anything on a phone-sized screen", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/register");
    for (const control of [
      page.getByLabel("Email"),
      page.getByLabel("Password", { exact: true }),
      page.getByRole("button", { name: "Show password" }),
      page.getByLabel("Display name"),
      page.getByRole("button", { name: "Create account" }),
    ]) {
      await control.focus();
      await expect(control).toBeFocused();
      expect(await isNotCovered(control)).toBe(true);
    }
  });
});
