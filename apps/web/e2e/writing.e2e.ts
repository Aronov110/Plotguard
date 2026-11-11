import { expect, type Page, test } from "@playwright/test";
import {
  createAccount,
  createProjectWithDocuments,
  deleteDocument,
  type SeedDocument,
} from "./support/api-control.ts";
import { expectNoAxeViolations } from "./support/axe.ts";
import { logIn, signUp } from "./support/flows.ts";
import { uniqueUser } from "./support/users.ts";

const outline = (page: Page) => page.getByRole("navigation", { name: "Outline" });
const textBox = (page: Page, title?: string) =>
  page.getByRole("textbox", { name: title === undefined ? /^Text of / : `Text of “${title}”` });
const saved = (page: Page) => page.getByText("Saved", { exact: true });
const unsaved = (page: Page) => page.getByText("Unsaved changes", { exact: true });

const STORY: readonly SeedDocument[] = [
  { title: "Act One", content: "The lighthouse stands alone." },
  { title: "The Storm", inside: "Act One", content: "Waves crash on the rocks." },
  { title: "Act Two", content: "Morning." },
];

/** Makes an account with a project and an outline (through the API) and logs in through the form. */
async function openStory(
  page: Page,
  request: Parameters<typeof createAccount>[0],
  documents: readonly SeedDocument[] = STORY,
  title = "The Lighthouse",
) {
  const user = uniqueUser();
  await createAccount(request, user);
  const seeded = await createProjectWithDocuments(request, user, { title, documents });
  await page.goto("/login");
  await logIn(page, user);
  await page.goto(`/app/projects/${seeded.projectId}`);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  return { user, ...seeded };
}

/** Replaces the whole text of the open document with `text`, the way a paste would. */
async function setText(page: Page, text: string, title?: string): Promise<void> {
  await textBox(page, title).fill(text);
}

test.describe("writing", () => {
  test("a new person starts a project, adds an act, writes, and the text survives a reload", async ({
    page,
  }) => {
    await signUp(page, uniqueUser());
    await page.getByLabel("Title").fill("My first story");
    await page.getByRole("button", { name: "Create project" }).click();
    await page.getByRole("link", { name: "My first story" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "My first story" })).toBeVisible();
    await expect(page.getByText("Add an act or a chapter to start writing.")).toBeVisible();

    await page.getByLabel("Title").fill("Act One");
    await page.getByRole("button", { name: "Add to the outline" }).click();

    // The new item opens, and the focus is in its text: the writer can start typing at once.
    await expect(textBox(page, "Act One")).toBeFocused();
    await page.keyboard.type("It was a dark and stormy night.");
    await expect(unsaved(page)).toBeVisible();
    // Saved by itself after a pause, with no button pressed.
    await expect(saved(page)).toBeVisible();
    await expect(outline(page).getByText("7 words")).toBeVisible();

    await page.reload();
    await expect(textBox(page, "Act One")).toHaveValue("It was a dark and stormy night.");
    await expect(saved(page)).toBeVisible();
  });

  test("choosing an item in the outline opens its text with the focus in the box", async ({
    page,
    request,
  }) => {
    await openStory(page, request);
    await expect(page.getByText("Choose an item in the outline to start writing.")).toBeVisible();

    await outline(page).getByRole("link", { name: "The Storm" }).click();

    await expect(textBox(page, "The Storm")).toHaveValue("Waves crash on the rocks.");
    await expect(textBox(page, "The Storm")).toBeFocused();
    await expect(outline(page).getByRole("link", { name: "The Storm" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("an address with an item opens it, and Back returns to the previous item", async ({
    page,
    request,
  }) => {
    await openStory(page, request);
    await outline(page).getByRole("link", { name: "Act One" }).click();
    await expect(textBox(page, "Act One")).toBeVisible();
    await outline(page).getByRole("link", { name: "Act Two" }).click();
    await expect(textBox(page, "Act Two")).toBeVisible();

    await page.goBack();
    await expect(textBox(page, "Act One")).toHaveValue("The lighthouse stands alone.");
    await expect(page).toHaveURL(/\?document=/);
  });

  test("writing with only the keyboard: Ctrl+S saves at once", async ({ page, request }) => {
    await openStory(page, request);
    await outline(page).getByRole("link", { name: "Act One" }).focus();
    await page.keyboard.press("Enter");
    await expect(textBox(page, "Act One")).toBeFocused();

    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" Its keeper is tired.");
    await expect(unsaved(page)).toBeVisible();
    await page.keyboard.press("ControlOrMeta+s");

    await expect(saved(page)).toBeVisible();
    await page.reload();
    await expect(textBox(page, "Act One")).toHaveValue(
      "The lighthouse stands alone. Its keeper is tired.",
    );
  });

  test("text typed just before choosing another item is saved", async ({ page, request }) => {
    await openStory(page, request);
    await outline(page).getByRole("link", { name: "Act One" }).click();
    await setText(page, "Act one, rewritten.", "Act One");
    await outline(page).getByRole("link", { name: "Act Two" }).click();
    await expect(textBox(page, "Act Two")).toHaveValue("Morning.");

    await outline(page).getByRole("link", { name: "Act One" }).click();
    await expect(textBox(page, "Act One")).toHaveValue("Act one, rewritten.");
    await page.reload();
    await expect(textBox(page, "Act One")).toHaveValue("Act one, rewritten.");
  });

  test("adds a scene inside the open act, shown under it", async ({ page, request }) => {
    await openStory(page, request);
    await outline(page).getByRole("link", { name: "Act Two" }).click();
    await expect(page.getByRole("radio", { name: "Inside “Act Two”" })).toBeChecked();

    await page.getByLabel("Title").fill("Dawn");
    await page.getByRole("button", { name: "Add to the outline" }).click();

    await expect(textBox(page, "Dawn")).toBeFocused();
    await expect(outline(page).getByRole("link")).toHaveText([
      "Act One",
      "The Storm",
      "Act Two",
      "Dawn",
    ]);
    await page.reload();
    await expect(outline(page).getByRole("link", { name: "Dawn" })).toBeVisible();
  });

  test("keeps the exact text: spaces, line breaks, emoji and right-to-left", async ({
    page,
    request,
  }) => {
    await openStory(page, request);
    await outline(page).getByRole("link", { name: "Act One" }).click();
    const text = "  INT. LIGHTHOUSE - NIGHT\n\n\t<b>Waves</b> crash 🎬 שלום مرحبا  \n";
    await setText(page, text, "Act One");
    await page.keyboard.press("ControlOrMeta+s");
    await expect(saved(page)).toBeVisible();

    await page.reload();
    await expect(textBox(page, "Act One")).toHaveValue(text);
  });

  test("shows markup in titles and text as text, never as markup", async ({ page, request }) => {
    const hostile = '<img src=x onerror="window.__hacked = 1">';
    await openStory(page, request, [
      { title: hostile, content: "<script>window.__hacked = 2</script>" },
    ]);
    await outline(page).getByRole("link", { name: hostile }).click();

    await expect(textBox(page, hostile)).toHaveValue("<script>window.__hacked = 2</script>");
    await expect(page.locator("main img, main script")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __hacked?: number }).__hacked)).toBe(
      undefined,
    );
  });

  test("a long text saves, and says how near the limit it is", async ({ page, request }) => {
    await openStory(page, request);
    await outline(page).getByRole("link", { name: "Act One" }).click();
    await setText(page, "a".repeat(195_000), "Act One");
    await expect(page.getByText("195,000 of 200,000 characters")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+s");
    await expect(saved(page)).toBeVisible();

    await page.reload();
    await expect(page.getByText("195,000 of 200,000 characters")).toBeVisible();
  });

  test("a text over the limit is explained, and kept in the box", async ({ page, request }) => {
    await openStory(page, request);
    await outline(page).getByRole("link", { name: "Act One" }).click();
    await setText(page, "a".repeat(200_001), "Act One");
    await page.keyboard.press("ControlOrMeta+s");

    await expect(page.getByRole("alert")).toContainText(/200000 characters|200,000 characters/);
    await expect(page.getByRole("alert")).toContainText("Not saved.");
    expect((await textBox(page, "Act One").inputValue()).length).toBe(200_001);
  });
});

test.describe("when things go wrong while writing", () => {
  test("when the connection is lost the text stays, and it is saved when it is back", async ({
    page,
    request,
  }) => {
    await openStory(page, request);
    await outline(page).getByRole("link", { name: "Act One" }).click();
    await expect(textBox(page, "Act One")).toBeVisible();

    await page.route("**/projects/*/documents/*", (route) =>
      route.request().method() === "PATCH" ? route.abort("failed") : route.continue(),
    );
    await setText(page, "Written while offline.", "Act One");
    await page.keyboard.press("ControlOrMeta+s");

    await expect(page.getByRole("alert")).toContainText("Your text is still here");
    await expect(textBox(page, "Act One")).toHaveValue("Written while offline.");

    await page.unroute("**/projects/*/documents/*");
    await page.keyboard.press("ControlOrMeta+s");
    await expect(saved(page)).toBeVisible();
    await page.reload();
    await expect(textBox(page, "Act One")).toHaveValue("Written while offline.");
  });

  test("another tab saved first: nothing is overwritten, and the writer chooses", async ({
    page,
    context,
    request,
  }) => {
    await openStory(page, request);
    await outline(page).getByRole("link", { name: "Act One" }).click();
    await expect(textBox(page, "Act One")).toHaveValue("The lighthouse stands alone.");

    // A second tab opens the same document and saves a newer text.
    const other = await context.newPage();
    await other.goto(page.url());
    await expect(textBox(other, "Act One")).toBeVisible();
    await setText(other, "Text from the other tab.", "Act One");
    await other.keyboard.press("ControlOrMeta+s");
    await expect(saved(other)).toBeVisible();

    // The first tab now tries to save its own text.
    await setText(page, "Text from the first tab.", "Act One");
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByRole("alert")).toContainText("This text was changed somewhere else.");
    await expect(textBox(page, "Act One")).toHaveValue("Text from the first tab.");

    await page.getByRole("button", { name: "Save my text over theirs" }).click();
    await expect(saved(page)).toBeVisible();
    await expect(textBox(page, "Act One")).toBeFocused();
    await page.reload();
    await expect(textBox(page, "Act One")).toHaveValue("Text from the first tab.");
  });

  test("another tab saved first: the writer can load the newer text instead", async ({
    page,
    context,
    request,
  }) => {
    await openStory(page, request);
    await outline(page).getByRole("link", { name: "Act One" }).click();
    await expect(textBox(page, "Act One")).toBeVisible();

    const other = await context.newPage();
    await other.goto(page.url());
    await setText(other, "Newer text.", "Act One");
    await other.keyboard.press("ControlOrMeta+s");
    await expect(saved(other)).toBeVisible();

    await setText(page, "My stale text.", "Act One");
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByRole("alert")).toContainText("This text was changed somewhere else.");

    await page.getByRole("button", { name: "Load the newer text (discard mine)" }).click();
    await expect(textBox(page, "Act One")).toHaveValue("Newer text.");
    await expect(saved(page)).toBeVisible();
    await expect(page.getByText("This text was changed somewhere else.")).toHaveCount(0);

    // And writing goes on from the newer version, without a new conflict.
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" More.");
    await page.keyboard.press("ControlOrMeta+s");
    await expect(saved(page)).toBeVisible();
    await page.reload();
    await expect(textBox(page, "Act One")).toHaveValue("Newer text. More.");
  });

  test("a document deleted elsewhere is reported, and the text can still be copied", async ({
    page,
    request,
  }) => {
    const { user, projectId, ids } = await openStory(page, request);
    await outline(page).getByRole("link", { name: "Act Two" }).click();
    await expect(textBox(page, "Act Two")).toBeVisible();

    const documentId = ids["Act Two"];
    if (documentId === undefined) throw new Error("The seeded act has no id.");
    await deleteDocument(request, user, projectId, documentId);

    await setText(page, "Orphaned words.", "Act Two");
    await page.keyboard.press("ControlOrMeta+s");

    await expect(page.getByRole("alert")).toContainText("copy it before you leave");
    await expect(textBox(page, "Act Two")).toHaveValue("Orphaned words.");
  });

  test("closing the tab with unsaved text asks first", async ({ page, request, browserName }) => {
    test.skip(browserName !== "chromium", "WebKit does not report the close prompt to the test.");
    await openStory(page, request);
    await outline(page).getByRole("link", { name: "Act One" }).click();
    await page.route("**/projects/*/documents/*", (route) =>
      route.request().method() === "PATCH" ? route.abort("failed") : route.continue(),
    );
    await setText(page, "Not saved yet.", "Act One");

    // The page asks before it closes. The question is waited for, and answered with "stay".
    const asked = page.waitForEvent("dialog");
    const closing = page.close({ runBeforeUnload: true });
    const dialog = await asked;
    expect(dialog.type()).toBe("beforeunload");
    await dialog.dismiss();
    await closing;
    expect(page.isClosed()).toBe(false);
  });
});

test.describe("who can write where", () => {
  test("a project that does not exist is reported", async ({ page }) => {
    await signUp(page, uniqueUser());
    await page.goto("/app/projects/00000000-0000-7000-8000-000000000000");
    await expect(page.getByRole("heading", { level: 1, name: "Project not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to your projects" })).toBeVisible();
  });

  test("someone else's project is reported as not found, with none of its text", async ({
    page,
    request,
  }) => {
    const [owner, other] = [uniqueUser(), uniqueUser()];
    await createAccount(request, owner);
    await createAccount(request, other);
    const seeded = await createProjectWithDocuments(request, owner, {
      title: "Private story",
      documents: [{ title: "Secret act", content: "Secret words." }],
    });

    await page.goto("/login");
    await logIn(page, other);
    await page.goto(`/app/projects/${seeded.projectId}?document=${seeded.ids["Secret act"]}`);
    await expect(page.getByRole("heading", { level: 1, name: "Project not found" })).toBeVisible();
    await expect(page.getByText("Secret")).toHaveCount(0);
    await expect(page.getByText("Private story")).toHaveCount(0);
  });

  test("a signed-out visit goes to the login screen and returns to the writing screen", async ({
    page,
    request,
  }) => {
    const user = uniqueUser();
    await createAccount(request, user);
    const seeded = await createProjectWithDocuments(request, user, {
      title: "Return here",
      documents: [{ title: "Act One" }],
    });
    await page.goto(`/app/projects/${seeded.projectId}`);
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Return here" })).toBeVisible();
  });
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`axe on the writing screen in ${colorScheme} mode (colour contrast included)`, () => {
    test.use({ colorScheme });

    test("with a text open", async ({ page, request }) => {
      await openStory(page, request);
      await outline(page).getByRole("link", { name: "The Storm" }).click();
      await expect(textBox(page, "The Storm")).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test("with nothing open", async ({ page, request }) => {
      await openStory(page, request);
      await expect(page.getByText("Choose an item in the outline to start writing.")).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test("with an empty outline", async ({ page, request }) => {
      await openStory(page, request, []);
      await expect(page.getByText("Add an act or a chapter to start writing.")).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test("with unsaved changes and with a problem alert", async ({ page, request }) => {
      await openStory(page, request);
      await outline(page).getByRole("link", { name: "Act One" }).click();
      await page.route("**/projects/*/documents/*", (route) =>
        route.request().method() === "PATCH" ? route.abort("failed") : route.continue(),
      );
      await setText(page, "Unsaved.", "Act One");
      await expect(unsaved(page)).toBeVisible();
      await expectNoAxeViolations(page);

      await page.keyboard.press("ControlOrMeta+s");
      await expect(page.getByRole("alert")).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test("with the conflict notice", async ({ page, context, request }) => {
      await openStory(page, request);
      await outline(page).getByRole("link", { name: "Act One" }).click();
      await expect(textBox(page, "Act One")).toBeVisible();
      const other = await context.newPage();
      await other.goto(page.url());
      await setText(other, "Other.", "Act One");
      await other.keyboard.press("ControlOrMeta+s");
      await expect(saved(other)).toBeVisible();

      await setText(page, "Mine.", "Act One");
      await page.keyboard.press("ControlOrMeta+s");
      await expect(page.getByRole("alert")).toContainText("changed somewhere else");
      await expectNoAxeViolations(page);
    });
  });
}

test.describe("the writing screen on a phone-sized screen (320 px wide)", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("the outline sits above the text, and nothing pushes the page sideways", async ({
    page,
    request,
  }) => {
    await openStory(page, request, [
      { title: "T".repeat(200), content: "W".repeat(5000) },
      { title: "A scene", inside: "T".repeat(200) },
    ]);
    await outline(page)
      .getByRole("link", { name: "T".repeat(200) })
      .click();
    await expect(textBox(page)).toBeVisible();

    const outlineBox = await outline(page).boundingBox();
    const text = await textBox(page).boundingBox();
    expect(outlineBox).not.toBeNull();
    expect(text).not.toBeNull();
    expect((outlineBox?.y ?? 0) + (outlineBox?.height ?? 0)).toBeLessThanOrEqual(
      (text?.y ?? 0) + 1,
    );

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("the add form, the links and the text box are at least 24 by 24 pixels", async ({
    page,
    request,
  }) => {
    await openStory(page, request);
    await outline(page).getByRole("link", { name: "Act One" }).click();
    await expect(textBox(page, "Act One")).toBeVisible();
    const tooSmall = await page
      .locator("button, input:not([type=hidden]), textarea, nav a")
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

test("the projects list leads to the writing screen", async ({ page, request }) => {
  const user = uniqueUser();
  await createAccount(request, user);
  await createProjectWithDocuments(request, user, {
    title: "From the list",
    documents: [{ title: "Act One" }],
  });
  await page.goto("/login");
  await logIn(page, user);
  await page.getByRole("link", { name: "From the list" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "From the list" })).toBeVisible();
  await expect(outline(page).getByRole("link", { name: "Act One" })).toBeVisible();
});
