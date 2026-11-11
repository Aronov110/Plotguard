import { expect, type Locator, type Page, test } from "@playwright/test";
import { createAccount, createProjects } from "./support/api-control.ts";
import { expectNoAxeViolations } from "./support/axe.ts";
import { logIn, PROJECTS_HEADING, signOut, signUp } from "./support/flows.ts";
import { uniqueUser } from "./support/users.ts";

const EMPTY = "You have no projects yet. Use the form above to start your first one.";
const PROJECT_TITLE = { level: 3 } as const;

const titleField = (page: Page) => page.getByLabel("Title");
const createButton = (page: Page) => page.getByRole("button", { name: "Create project" });
const loadMoreButton = (page: Page) => page.getByRole("button", { name: "Load more projects" });

/** Makes an account with the given projects (through the API) and logs in through the form. */
async function logInWithProjects(
  page: Page,
  request: Parameters<typeof createAccount>[0],
  projects: Parameters<typeof createProjects>[2],
): Promise<void> {
  const user = uniqueUser();
  await createAccount(request, user);
  await createProjects(request, user, projects);
  await page.goto("/login");
  await logIn(page, user);
}

const numbered = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    title: `Project ${String(index + 1).padStart(2, "0")}`,
  }));

/** True when something on the screen shows that the element has the keyboard focus. */
async function showsFocusRing(element: Locator): Promise<boolean> {
  return element.evaluate((node) => {
    const style = getComputedStyle(node);
    const outline = style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0;
    return outline || style.boxShadow !== "none";
  });
}

test.describe("the projects screen", () => {
  test("a new person starts with an empty list, and a project made with the keyboard survives a reload", async ({
    page,
  }) => {
    await signUp(page, uniqueUser());
    await expect(page.getByText(EMPTY)).toBeVisible();

    await titleField(page).focus();
    await page.keyboard.type("Lighthouse");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("radio", { name: "Screenplay" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio", { name: "Prose" })).toBeChecked();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("textbox", { name: "Logline (optional)" })).toBeFocused();
    await page.keyboard.type("A keeper finds a message.");
    await page.keyboard.press("Tab");
    await expect(createButton(page)).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page.getByText("Project “Lighthouse” created.")).toBeVisible();
    await expect(page.getByRole("heading", { ...PROJECT_TITLE, name: "Lighthouse" })).toBeVisible();
    await expect(page.getByText("A keeper finds a message.")).toBeVisible();
    await expect(page.getByText(EMPTY)).toHaveCount(0);

    // The form starts again and the focus is on the title, so the next project can be typed at once.
    await expect(titleField(page)).toBeFocused();
    await expect(titleField(page)).toHaveValue("");
    await expect(page.getByRole("radio", { name: "Screenplay" })).toBeChecked();
    await expect(page.getByRole("textbox", { name: "Logline (optional)" })).toHaveValue("");
    // A real browser empties the field for good: the next typing does not join the old text.
    await page.keyboard.type("Second");
    await expect(titleField(page)).toHaveValue("Second");

    await page.reload();
    await expect(page.getByRole("heading", PROJECTS_HEADING)).toBeVisible();
    await expect(page.getByRole("heading", { ...PROJECT_TITLE, name: "Lighthouse" })).toBeVisible();
  });

  test("a new project goes to the top of the list", async ({ page, request }) => {
    await logInWithProjects(page, request, numbered(2));
    await expect(page.getByRole("heading", PROJECT_TITLE)).toHaveCount(2);

    await titleField(page).fill("Brand new");
    await createButton(page).click();

    await expect(page.getByRole("heading", PROJECT_TITLE).first()).toHaveText("Brand new");
    await expect(page.getByRole("heading", PROJECT_TITLE)).toHaveCount(3);
  });

  test("a long list comes in pages: 20 first, then the rest on request, with the focus on the first new one", async ({
    page,
    request,
  }) => {
    await logInWithProjects(page, request, numbered(21));

    const titles = page.getByRole("heading", PROJECT_TITLE);
    await expect(titles).toHaveCount(20);
    // Newest change first: the last one created tops the list.
    await expect(titles.first()).toHaveText("Project 21");
    await expect(loadMoreButton(page)).toBeVisible();

    await loadMoreButton(page).click();

    await expect(titles).toHaveCount(21);
    await expect(titles.last()).toHaveText("Project 01");
    await expect(page.locator("li:focus")).toContainText("Project 01");
    await expect(page.getByText("1 more project loaded.")).toBeAttached();
    await expect(loadMoreButton(page)).toHaveCount(0);
  });

  test("a problem with the form is explained, and what was typed stays", async ({ page }) => {
    await signUp(page, uniqueUser());

    await createButton(page).click();
    await expect(page.getByRole("alert")).toContainText("Enter a title.");
    await expect(page.getByRole("alert")).toBeFocused();

    await titleField(page).fill("x".repeat(201));
    await page.getByRole("radio", { name: "Other" }).check();
    await createButton(page).click();

    // The 200-character rule is the API's; the page shows the API's words.
    await expect(page.getByRole("alert")).toContainText(/200 characters/);
    await expect(titleField(page)).toHaveValue("x".repeat(201));
    await expect(page.getByRole("radio", { name: "Other" })).toBeChecked();
    await expect(page.getByRole("heading", PROJECT_TITLE)).toHaveCount(0);
  });

  test("a list that cannot be loaded says so, and loads when asked again", async ({
    page,
    request,
  }) => {
    const user = uniqueUser();
    await createAccount(request, user);
    await createProjects(request, user, [{ title: "Worth waiting for" }]);
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(user.password);

    // Only the list is cut off (GET); the rest of the app keeps working.
    await page.route("**/projects", (route) =>
      route.request().method() === "GET" ? route.abort("failed") : route.continue(),
    );
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page.getByRole("alert")).toContainText("Can't reach the server");
    await page.unroute("**/projects");
    await page.getByRole("button", { name: "Try again" }).click();

    await expect(
      page.getByRole("heading", { ...PROJECT_TITLE, name: "Worth waiting for" }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("people never see each other's projects", async ({ page, request }) => {
    const [owner, other] = [uniqueUser(), uniqueUser()];
    await createAccount(request, owner);
    await createAccount(request, other);
    await createProjects(request, owner, [{ title: "Secret of the owner" }]);

    await page.goto("/login");
    await logIn(page, owner);
    await expect(
      page.getByRole("heading", { ...PROJECT_TITLE, name: "Secret of the owner" }),
    ).toBeVisible();
    await signOut(page);

    await logIn(page, other);
    await expect(page.getByText(EMPTY)).toBeVisible();
    await expect(page.getByText("Secret of the owner")).toHaveCount(0);
  });

  test("what a person wrote is shown as text, never run as markup", async ({ page, request }) => {
    const hostile = '<img src=x onerror="window.__hacked = 1"><script>window.__hacked = 2</script>';
    await logInWithProjects(page, request, [{ title: hostile, logline: "<b>not bold</b>" }]);

    await expect(page.getByRole("heading", { ...PROJECT_TITLE, name: hostile })).toBeVisible();
    await expect(page.getByText("<b>not bold</b>")).toBeVisible();
    await expect(page.locator("main img, main script, main b")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __hacked?: number }).__hacked)).toBe(
      undefined,
    );
  });

  test("writing in a right-to-left language, with emoji, works end to end", async ({ page }) => {
    await signUp(page, uniqueUser());
    await titleField(page).fill("שלום 🎬 مرحبا");
    await createButton(page).click();
    await expect(
      page.getByRole("heading", { ...PROJECT_TITLE, name: "שלום 🎬 مرحبا" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { ...PROJECT_TITLE, name: "שלום 🎬 مرحبا" }),
    ).toBeVisible();
  });
});

test.describe("using the projects screen with only the keyboard", () => {
  test("every control shows where the focus is", async ({ page }) => {
    await signUp(page, uniqueUser());
    await titleField(page).focus();
    for (const [index, control] of [
      titleField(page),
      page.getByRole("radio", { name: "Screenplay" }),
      page.getByRole("textbox", { name: "Logline (optional)" }),
      createButton(page),
    ].entries()) {
      if (index > 0) await page.keyboard.press("Tab");
      await expect(control).toBeFocused();
      expect(await showsFocusRing(control)).toBe(true);
    }
  });

  test("Load more can be pressed with the keyboard", async ({ page, request }) => {
    await logInWithProjects(page, request, numbered(21));
    await expect(page.getByRole("heading", PROJECT_TITLE)).toHaveCount(20);
    await loadMoreButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", PROJECT_TITLE)).toHaveCount(21);
  });
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`axe on the projects screen in ${colorScheme} mode (colour contrast included)`, () => {
    test.use({ colorScheme });

    test("with projects and a Load more button", async ({ page, request }) => {
      await logInWithProjects(page, request, [
        { title: "Lighthouse", logline: "A keeper finds a message." },
        ...numbered(20),
      ]);
      await expect(loadMoreButton(page)).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test("with a problem in the form", async ({ page }) => {
      await signUp(page, uniqueUser());
      await createButton(page).click();
      await expect(page.getByRole("alert")).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test("with the message after a project was created", async ({ page }) => {
      await signUp(page, uniqueUser());
      await titleField(page).fill("Fine");
      await createButton(page).click();
      await expect(page.getByText("Project “Fine” created.")).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test("when the list could not be loaded", async ({ page }) => {
      await signUp(page, uniqueUser());
      await page.route("**/projects", (route) =>
        route.request().method() === "GET" ? route.abort("failed") : route.continue(),
      );
      await page.reload();
      await expect(page.getByRole("alert")).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });
}

test.describe("the projects screen on a phone-sized screen (320 px wide)", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("very long words in a title and a logline do not push the page sideways", async ({
    page,
    request,
  }) => {
    await logInWithProjects(page, request, [
      { title: "T".repeat(200), logline: "L".repeat(1000) },
      ...numbered(20),
    ]);
    await expect(loadMoreButton(page)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("the form with problems needs no sideways scrolling, and nothing covers a control", async ({
    page,
  }) => {
    await signUp(page, uniqueUser());
    await createButton(page).click();
    await expect(page.getByRole("alert")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    for (const control of [
      titleField(page),
      page.getByRole("radio", { name: "Prose" }),
      page.getByRole("textbox", { name: "Logline (optional)" }),
      createButton(page),
    ]) {
      await control.focus();
      const covered = await control.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return !(top === node || node.contains(top));
      });
      expect(covered).toBe(false);
    }
  });
});

test.describe("buttons, radio buttons and fields on the projects screen are at least 24 by 24 pixels", () => {
  test("with projects and a Load more button", async ({ page, request }) => {
    await logInWithProjects(page, request, numbered(21));
    await expect(loadMoreButton(page)).toBeVisible();
    const tooSmall = await page
      .locator("button, input:not([type=hidden]), textarea, a.button")
      .evaluateAll((elements) =>
        elements
          .map((element) => ({
            html: element.outerHTML.slice(0, 100),
            box: element.getBoundingClientRect(),
          }))
          .filter(({ box }) => box.width > 0 && (box.width < 24 || box.height < 24))
          .map(({ html, box }) => `${html} is ${Math.round(box.width)}x${Math.round(box.height)}`),
      );
    expect(tooSmall).toEqual([]);
  });
});
