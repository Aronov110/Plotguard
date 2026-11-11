import { expect, type Page, test } from "@playwright/test";
import { createAccount, createProjects } from "./support/api-control.ts";
import { expectNoAxeViolations } from "./support/axe.ts";
import { logIn, signUp } from "./support/flows.ts";
import { uniqueUser } from "./support/users.ts";

const EMPTY = "You have no projects yet. Use the form above to start your first one.";
const H3 = { level: 3 } as const;

// The page also holds the new-project form, which has a "Title" of its own: the fields of an edit
// form are always looked up inside that form.
const editForm = (page: Page, title: string) =>
  page.getByRole("form", { name: `Edit project “${title}”` });
const editButton = (page: Page, title: string) =>
  page.getByRole("button", { name: `Edit project “${title}”`, exact: true });
const deleteButton = (page: Page, title: string) =>
  page.getByRole("button", { name: `Delete project “${title}”`, exact: true });
const heading = (page: Page, title: string) =>
  page.getByRole("heading", { ...H3, name: title, exact: true });
const confirmDelete = (page: Page) =>
  page.getByRole("button", { name: "Delete project", exact: true });
const keepButton = (page: Page) => page.getByRole("button", { name: "Keep project" });

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

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("editing a project", () => {
  test("changes the title, format and logline with the keyboard only, and the change survives a reload", async ({
    page,
    request,
  }) => {
    await logInWithProjects(page, request, [
      { title: "Older", logline: "Old logline." },
      { title: "Newer" },
    ]);
    await expect(heading(page, "Newer")).toBeVisible();

    await editButton(page, "Older").focus();
    await page.keyboard.press("Enter");

    const form = editForm(page, "Older");
    await expect(form.getByLabel("Title")).toBeFocused();
    await expect(form.getByLabel("Title")).toHaveValue("Older");
    await expect(form.getByRole("textbox", { name: "Logline (optional)" })).toHaveValue(
      "Old logline.",
    );

    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Renamed");
    await page.keyboard.press("Tab");
    await expect(form.getByRole("radio", { name: "Screenplay" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(form.getByRole("radio", { name: "Prose" })).toBeChecked();
    await page.keyboard.press("Tab");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("A new logline.");
    await page.keyboard.press("Tab");
    await expect(form.getByRole("button", { name: "Save changes" })).toBeFocused();
    await page.keyboard.press("Enter");

    // The project goes to the top (the list is sorted by last change), the focus returns to the
    // card's Edit button, and the change is announced.
    await expect(heading(page, "Renamed")).toBeVisible();
    await expect(page.getByRole("heading", H3).first()).toHaveText("Renamed");
    await expect(page.getByText("A new logline.")).toBeVisible();
    await expect(editButton(page, "Renamed")).toBeFocused();
    await expect(page.getByText("Project “Renamed” saved.")).toBeAttached();
    await expect(editForm(page, "Renamed")).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("heading", H3).first()).toHaveText("Renamed");
    await expect(page.getByText("A new logline.")).toBeVisible();
    await expect(page.getByText("Prose", { exact: false }).first()).toBeVisible();
  });

  test("Cancel changes nothing and puts the focus back on Edit", async ({ page, request }) => {
    await logInWithProjects(page, request, [{ title: "Keeper", logline: "Stays." }]);
    await editButton(page, "Keeper").click();
    await editForm(page, "Keeper").getByLabel("Title").fill("Abandoned change");
    await editForm(page, "Keeper").getByRole("button", { name: "Cancel" }).click();

    await expect(heading(page, "Keeper")).toBeVisible();
    await expect(editButton(page, "Keeper")).toBeFocused();
    await page.reload();
    await expect(heading(page, "Keeper")).toBeVisible();
    await expect(page.getByText("Abandoned change")).toHaveCount(0);
  });

  test("saving without a change sends nothing and says so", async ({ page, request }) => {
    await logInWithProjects(page, request, [{ title: "Same" }]);
    const patches: string[] = [];
    page.on("request", (sent) => {
      if (sent.method() === "PATCH") patches.push(sent.url());
    });

    await editButton(page, "Same").click();
    await editForm(page, "Same").getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText("No changes to save.")).toBeAttached();
    await expect(heading(page, "Same")).toBeVisible();
    await expect(editButton(page, "Same")).toBeFocused();
    expect(patches).toEqual([]);
  });

  test("clearing the logline removes it, also after a reload", async ({ page, request }) => {
    await logInWithProjects(page, request, [{ title: "Had one", logline: "Remove me." }]);
    await editButton(page, "Had one").click();
    await editForm(page, "Had one").getByRole("textbox", { name: "Logline (optional)" }).fill("");
    await editForm(page, "Had one").getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText("Project “Had one” saved.")).toBeAttached();
    await expect(page.getByText("Remove me.")).toHaveCount(0);
    await page.reload();
    await expect(heading(page, "Had one")).toBeVisible();
    await expect(page.getByText("Remove me.")).toHaveCount(0);
  });

  test("a problem is explained next to the form, and what was typed stays", async ({
    page,
    request,
  }) => {
    await logInWithProjects(page, request, [{ title: "Fine" }]);
    await editButton(page, "Fine").click();
    const form = editForm(page, "Fine");

    await form.getByLabel("Title").fill("");
    await form.getByRole("button", { name: "Save changes" }).click();
    await expect(form.getByRole("alert")).toContainText("Enter a title.");
    await expect(form.getByRole("alert")).toBeFocused();

    await form.getByLabel("Title").fill("x".repeat(201));
    await form.getByRole("button", { name: "Save changes" }).click();
    // The 200-character rule is the API's; the page shows the API's words.
    await expect(form.getByRole("alert")).toContainText(/200 characters/);
    await expect(form.getByLabel("Title")).toHaveValue("x".repeat(201));
    await form.getByRole("button", { name: "Cancel" }).click();
    await expect(heading(page, "Fine")).toBeVisible();
  });

  test("another open form keeps its text when a different project is saved", async ({
    page,
    request,
  }) => {
    await logInWithProjects(page, request, [{ title: "Alpha" }, { title: "Beta" }]);
    await editButton(page, "Alpha").click();
    await editForm(page, "Alpha").getByLabel("Title").fill("Alpha (draft)");
    await editButton(page, "Beta").click();
    await editForm(page, "Beta").getByLabel("Title").fill("Beta saved");
    await editForm(page, "Beta").getByRole("button", { name: "Save changes" }).click();

    await expect(heading(page, "Beta saved")).toBeVisible();
    await expect(editForm(page, "Alpha").getByLabel("Title")).toHaveValue("Alpha (draft)");
  });

  test("a project deleted in another tab is reported when its form is saved", async ({
    page,
    context,
    request,
  }) => {
    await logInWithProjects(page, request, [{ title: "Doomed" }]);
    await editButton(page, "Doomed").click();
    await editForm(page, "Doomed").getByLabel("Title").fill("Too late");

    const other = await context.newPage();
    await other.goto("/app");
    await deleteButton(other, "Doomed").click();
    await confirmDelete(other).click();
    await expect(other.getByText(EMPTY)).toBeVisible();

    await editForm(page, "Doomed").getByRole("button", { name: "Save changes" }).click();
    await expect(editForm(page, "Doomed").getByRole("alert")).toContainText(
      "This project no longer exists.",
    );
    await expect(editForm(page, "Doomed").getByLabel("Title")).toHaveValue("Too late");
  });

  test("markup typed into a title is shown as text, never run", async ({ page, request }) => {
    const hostile = '<img src=x onerror="window.__hacked = 1">';
    await logInWithProjects(page, request, [{ title: "Plain" }]);
    await editButton(page, "Plain").click();
    await editForm(page, "Plain").getByLabel("Title").fill(hostile);
    await editForm(page, "Plain").getByRole("button", { name: "Save changes" }).click();

    await expect(heading(page, hostile)).toBeVisible();
    await expect(page.locator("main img")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __hacked?: number }).__hacked)).toBe(
      undefined,
    );
    await page.reload();
    await expect(heading(page, hostile)).toBeVisible();
  });
});

test.describe("deleting a project", () => {
  test("asks first with the focus on Keep, keeps on Escape, and deletes only when confirmed", async ({
    page,
    request,
  }) => {
    await logInWithProjects(page, request, [
      { title: "First" },
      { title: "Second" },
      { title: "Third" },
    ]);
    // Newest change first: Third, Second, First.
    const deletes: string[] = [];
    page.on("request", (sent) => {
      if (sent.method() === "DELETE") deletes.push(sent.url());
    });

    await deleteButton(page, "Second").focus();
    await page.keyboard.press("Enter");
    const question = page.getByRole("group", { name: "Delete “Second”?" });
    await expect(question).toBeVisible();
    await expect(question).toContainText("cannot be undone");
    await expect(keepButton(page)).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(question).toHaveCount(0);
    await expect(deleteButton(page, "Second")).toBeFocused();
    expect(deletes).toEqual([]);

    await page.keyboard.press("Enter");
    await expect(keepButton(page)).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(confirmDelete(page)).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(heading(page, "Second")).toHaveCount(0);
    await expect(page.getByRole("heading", H3)).toHaveText(["Third", "First"]);
    // The focus moves to the project that took its place.
    await expect(page.locator("li:focus")).toContainText("First");
    await expect(page.getByText("Project “Second” deleted.")).toBeAttached();
    expect(deletes).toHaveLength(1);

    await page.reload();
    await expect(page.getByRole("heading", H3)).toHaveText(["Third", "First"]);
  });

  test("Keep leaves the project in place", async ({ page, request }) => {
    await logInWithProjects(page, request, [{ title: "Safe" }]);
    await deleteButton(page, "Safe").click();
    await keepButton(page).click();
    await expect(heading(page, "Safe")).toBeVisible();
    await expect(deleteButton(page, "Safe")).toBeFocused();
    await page.reload();
    await expect(heading(page, "Safe")).toBeVisible();
  });

  test("deleting the last project shows the empty message and puts the focus on the list's heading", async ({
    page,
    request,
  }) => {
    await logInWithProjects(page, request, [{ title: "Only" }]);
    await deleteButton(page, "Only").click();
    await confirmDelete(page).click();

    await expect(page.getByText(EMPTY)).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "All your projects" })).toBeFocused();
    await page.reload();
    await expect(page.getByText(EMPTY)).toBeVisible();
  });

  test("a project that is already gone is simply taken out of the list", async ({
    page,
    context,
    request,
  }) => {
    await logInWithProjects(page, request, [{ title: "Gone elsewhere" }, { title: "Stays" }]);
    await deleteButton(page, "Gone elsewhere").click();

    const other = await context.newPage();
    await other.goto("/app");
    await deleteButton(other, "Gone elsewhere").click();
    await confirmDelete(other).click();
    await expect(heading(other, "Gone elsewhere")).toHaveCount(0);

    await confirmDelete(page).click();
    await expect(heading(page, "Gone elsewhere")).toHaveCount(0);
    await expect(heading(page, "Stays")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("a failed delete keeps the project and says why", async ({ page, request }) => {
    await logInWithProjects(page, request, [{ title: "Stuck" }]);
    await page.route("**/projects/*", (route) =>
      route.request().method() === "DELETE" ? route.abort("failed") : route.continue(),
    );
    await deleteButton(page, "Stuck").click();
    await confirmDelete(page).click();

    await expect(page.getByRole("alert")).toContainText("Can't reach the server");
    await expect(heading(page, "Stuck")).toBeVisible();

    await page.unroute("**/projects/*");
    await confirmDelete(page).click();
    await expect(page.getByText(EMPTY)).toBeVisible();
  });
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`axe on editing and deleting in ${colorScheme} mode (colour contrast included)`, () => {
    test.use({ colorScheme });

    test("with an edit form open", async ({ page, request }) => {
      await logInWithProjects(page, request, [
        { title: "Edited", logline: "A logline." },
        { title: "Other" },
      ]);
      await editButton(page, "Edited").click();
      await expect(editForm(page, "Edited")).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test("with a problem in the edit form", async ({ page, request }) => {
      await logInWithProjects(page, request, [{ title: "Edited" }]);
      await editButton(page, "Edited").click();
      await editForm(page, "Edited").getByLabel("Title").fill("");
      await editForm(page, "Edited").getByRole("button", { name: "Save changes" }).click();
      await expect(editForm(page, "Edited").getByRole("alert")).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test("with the delete question open", async ({ page, request }) => {
      await logInWithProjects(page, request, [{ title: "Doomed", logline: "A logline." }]);
      await deleteButton(page, "Doomed").click();
      await expect(keepButton(page)).toBeFocused();
      await expectNoAxeViolations(page);
    });

    test("with a failed delete shown in the question", async ({ page, request }) => {
      await logInWithProjects(page, request, [{ title: "Stuck" }]);
      await page.route("**/projects/*", (route) =>
        route.request().method() === "DELETE" ? route.abort("failed") : route.continue(),
      );
      await deleteButton(page, "Stuck").click();
      await confirmDelete(page).click();
      await expect(page.getByRole("alert")).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test("with the message after a project was saved", async ({ page, request }) => {
      await logInWithProjects(page, request, [{ title: "Saved" }]);
      await editButton(page, "Saved").click();
      await editForm(page, "Saved").getByLabel("Title").fill("Saved again");
      await editForm(page, "Saved").getByRole("button", { name: "Save changes" }).click();
      await expect(heading(page, "Saved again")).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });
}

test.describe("editing and deleting on a phone-sized screen (320 px wide)", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("an edit form with very long text needs no sideways scrolling, and nothing covers a button", async ({
    page,
    request,
  }) => {
    await logInWithProjects(page, request, [{ title: "T".repeat(200), logline: "L".repeat(1000) }]);
    await page.getByRole("button", { name: /^Edit project/ }).click();
    await expect(page.getByRole("form", { name: /^Edit project/ })).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);

    for (const name of ["Save changes", "Cancel"]) {
      const button = page.getByRole("button", { name });
      await button.focus();
      const covered = await button.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return !(top === node || node.contains(top));
      });
      expect(covered).toBe(false);
    }
  });

  test("the delete question with a very long title needs no sideways scrolling", async ({
    page,
    request,
  }) => {
    await logInWithProjects(page, request, [{ title: "T".repeat(200), logline: "L".repeat(1000) }]);
    await page.getByRole("button", { name: /^Delete project/ }).click();
    await expect(keepButton(page)).toBeFocused();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("buttons, radio buttons and fields in the change states are at least 24 by 24 pixels", () => {
  test("with an edit form and then the delete question", async ({ page, request }) => {
    await logInWithProjects(page, request, [
      { title: "Sized", logline: "A logline." },
      { title: "Other" },
    ]);
    const tooSmall = () =>
      page.locator("button, input:not([type=hidden]), textarea, a.button").evaluateAll((elements) =>
        elements
          .map((element) => ({
            html: element.outerHTML.slice(0, 100),
            box: element.getBoundingClientRect(),
          }))
          .filter(({ box }) => box.width > 0 && (box.width < 24 || box.height < 24))
          .map(({ html, box }) => `${html} is ${Math.round(box.width)}x${Math.round(box.height)}`),
      );

    await editButton(page, "Sized").click();
    expect(await tooSmall()).toEqual([]);
    await editForm(page, "Sized").getByRole("button", { name: "Cancel" }).click();
    await deleteButton(page, "Sized").click();
    expect(await tooSmall()).toEqual([]);
  });
});

test("a new account can create, change and delete its first project end to end", async ({
  page,
}) => {
  await signUp(page, uniqueUser());
  await page.getByLabel("Title").fill("Lifecycle");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(heading(page, "Lifecycle")).toBeVisible();

  await editButton(page, "Lifecycle").click();
  await editForm(page, "Lifecycle").getByLabel("Title").fill("Lifecycle, revised");
  await editForm(page, "Lifecycle").getByRole("button", { name: "Save changes" }).click();
  await expect(heading(page, "Lifecycle, revised")).toBeVisible();

  await deleteButton(page, "Lifecycle, revised").click();
  await confirmDelete(page).click();
  await expect(page.getByText(EMPTY)).toBeVisible();
});
