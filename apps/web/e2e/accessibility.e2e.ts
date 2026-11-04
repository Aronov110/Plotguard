import { expect, type Page, test } from "@playwright/test";
import { createAccount } from "./support/api-control.ts";
import { expectNoAxeViolations } from "./support/axe.ts";
import { PROJECTS_HEADING, signUp, submitLoginForm } from "./support/flows.ts";
import { uniqueUser } from "./support/users.ts";

/** The screens a signed-out visitor can reach, with the title each must have. */
const SIGNED_OUT_SCREENS = [
  { path: "/", title: "Plotpal", heading: "Plotpal" },
  { path: "/login", title: "Log in – Plotpal", heading: "Log in" },
  { path: "/register", title: "Create your account – Plotpal", heading: "Create your account" },
  { path: "/no-such-screen", title: "Page not found – Plotpal", heading: "Page not found" },
] as const;

const SIZE_OF_TARGETS = "button, input:not([type=hidden]), a.button";
const MINIMUM_TARGET_PX = 24;

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function expectTargetsBigEnough(page: Page): Promise<void> {
  const tooSmall = await page.locator(SIZE_OF_TARGETS).evaluateAll(
    (elements, minimum) =>
      elements
        .map((element) => ({
          html: element.outerHTML.slice(0, 120),
          box: element.getBoundingClientRect(),
        }))
        .filter(({ box }) => box.width > 0 && (box.width < minimum || box.height < minimum))
        .map(({ html, box }) => `${html} is ${Math.round(box.width)}x${Math.round(box.height)}`),
    MINIMUM_TARGET_PX,
  );
  expect(tooSmall).toEqual([]);
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`axe in ${colorScheme} mode (colour contrast included)`, () => {
    test.use({ colorScheme });

    for (const screen of SIGNED_OUT_SCREENS) {
      test(`${screen.path} has no accessibility violations`, async ({ page }) => {
        await page.goto(screen.path);
        await expect(page.getByRole("heading", { level: 1, name: screen.heading })).toBeVisible();
        await expectNoAxeViolations(page);
      });
    }

    test("the signed-in home has no accessibility violations", async ({ page }) => {
      await signUp(page, uniqueUser());
      await expectNoAxeViolations(page);
    });

    test("the error summary and the field errors have no violations", async ({ page }) => {
      await page.goto("/register");
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test("a shown password has no violations", async ({ page }) => {
      await page.goto("/login");
      await page.getByLabel("Password", { exact: true }).fill("a shown password");
      await page.getByRole("button", { name: "Show password" }).click();
      await expectNoAxeViolations(page);
    });

    test("the notice for a sign-out the server did not confirm has no violations", async ({
      page,
    }) => {
      await signUp(page, uniqueUser());
      await page.route("**/auth/logout", (route) => route.abort("failed"));
      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page.getByRole("status").filter({ hasText: "could not confirm" })).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test("the busy state of a form has no violations", async ({ page, request }) => {
      const user = uniqueUser();
      await createAccount(request, user);
      // Hold the login answer so the form stays in its "Signing you in…" state while axe runs.
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/auth/login", async (route) => {
        await held;
        await route.continue();
      });
      await page.goto("/login");
      await submitLoginForm(page, user.email, user.password);
      await expect(page.getByText("Signing you in…")).toBeVisible();
      await expectNoAxeViolations(page);
      release();
      await expect(page.getByRole("heading", PROJECTS_HEADING)).toBeVisible();
    });
  });
}

test.describe("every screen has a title, a language and one main heading", () => {
  for (const screen of SIGNED_OUT_SCREENS) {
    test(`${screen.path}`, async ({ page }) => {
      await page.goto(screen.path);
      await expect(page).toHaveTitle(screen.title);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
    });
  }

  test("the signed-in home", async ({ page }) => {
    await signUp(page, uniqueUser());
    await expect(page).toHaveTitle("Your projects – Plotpal");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
  });
});

test.describe("a phone-sized screen (320 px wide)", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  for (const screen of SIGNED_OUT_SCREENS) {
    test(`${screen.path} needs no sideways scrolling`, async ({ page }) => {
      await page.goto(screen.path);
      await expect(page.getByRole("heading", { level: 1, name: screen.heading })).toBeVisible();
      await expectNoSidewaysScroll(page);
    });
  }

  test("the sign-up form with an error summary needs no sideways scrolling", async ({ page }) => {
    await page.goto("/register");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expectNoSidewaysScroll(page);
  });

  test("the signed-in home needs no sideways scrolling", async ({ page }) => {
    await signUp(page, uniqueUser());
    await expectNoSidewaysScroll(page);
  });
});

test.describe("buttons and fields are at least 24 by 24 pixels", () => {
  for (const screen of SIGNED_OUT_SCREENS) {
    test(`${screen.path}`, async ({ page }) => {
      await page.goto(screen.path);
      await expect(page.getByRole("heading", { level: 1, name: screen.heading })).toBeVisible();
      await expectTargetsBigEnough(page);
    });
  }

  test("the signed-in home", async ({ page }) => {
    await signUp(page, uniqueUser());
    await expectTargetsBigEnough(page);
  });

  test("the same on a phone-sized screen", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/register");
    await expectTargetsBigEnough(page);
  });
});
