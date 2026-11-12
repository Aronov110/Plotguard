import { expect, type Page, test } from "@playwright/test";
import {
  createAccount,
  createProjectWithDocuments,
  deleteDocument,
  readOutline,
  type SeedDocument,
} from "./support/api-control.ts";
import { expectNoAxeViolations } from "./support/axe.ts";
import { logIn } from "./support/flows.ts";
import { uniqueUser } from "./support/users.ts";

const outline = (page: Page) => page.getByRole("navigation", { name: "Outline" });
const textBox = (page: Page, title?: string) =>
  page.getByRole("textbox", { name: title === undefined ? /^Text of / : `Text of “${title}”` });
const saved = (page: Page) => page.getByText("Saved", { exact: true });
const toolbar = (page: Page, title: string) =>
  page.getByRole("group", { name: `Actions for “${title}”` });
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const linkTitles = (page: Page) => outline(page).getByRole("link").allTextContents();
const announced = (page: Page, text: RegExp) => page.getByRole("status").filter({ hasText: text });

const STORY_TITLES = ["Act One", "Scene A", "Scene B", "Scene C", "Act Two"];
const STORY: readonly SeedDocument[] = [
  { title: "Act One", content: "The lighthouse stands alone." },
  { title: "Scene A", inside: "Act One", content: "Waves crash on the rocks." },
  { title: "Scene B", inside: "Act One", content: "The keeper climbs the stairs." },
  { title: "Scene C", inside: "Act One", content: "The lamp turns." },
  { title: "Act Two", content: "Morning." },
];

/** Makes an account with a project and an outline (through the API), logs in, and opens the project. */
async function openStory(
  page: Page,
  request: Parameters<typeof createAccount>[0],
  documents: readonly SeedDocument[] = STORY,
) {
  const user = uniqueUser();
  await createAccount(request, user);
  const seeded = await createProjectWithDocuments(request, user, {
    title: "The Lighthouse",
    documents,
  });
  await page.goto("/login");
  await logIn(page, user);
  await page.goto(`/app/projects/${seeded.projectId}`);
  await expect(page.getByRole("heading", { level: 1, name: "The Lighthouse" })).toBeVisible();
  return { user, ...seeded };
}

async function openItem(page: Page, title: string): Promise<void> {
  await outline(page).getByRole("link", { name: title, exact: true }).click();
  await expect(textBox(page, title)).toBeVisible();
}

/** The titles the server has, in the order it gives them. */
async function serverTitles(
  request: Parameters<typeof createAccount>[0],
  story: Awaited<ReturnType<typeof openStory>>,
): Promise<string[]> {
  return (await readOutline(request, story.user, story.projectId)).map((entry) => entry.title);
}

test.describe("renaming an item", () => {
  test("shows the new title everywhere, keeps the text, and survives a reload", async ({
    page,
    request,
  }) => {
    const story = await openStory(page, request);
    await openItem(page, "Scene A");

    await button(page, "Rename").click();
    await expect(page.getByRole("textbox", { name: "New title" })).toBeFocused();
    await page.keyboard.type("Scene A: the storm");
    await page.keyboard.press("Enter");

    await expect(outline(page).getByRole("link", { name: "Scene A: the storm" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Scene A: the storm" })).toBeVisible();
    await expect(textBox(page, "Scene A: the storm")).toHaveValue("Waves crash on the rocks.");
    await expect(toolbar(page, "Scene A: the storm")).toBeVisible();
    await expect(button(page, "Rename")).toBeFocused();
    await expect(announced(page, /Renamed to “Scene A: the storm”\./)).toHaveCount(1);
    expect(await serverTitles(request, story)).toContain("Scene A: the storm");

    await page.reload();
    await expect(textBox(page, "Scene A: the storm")).toHaveValue("Waves crash on the rocks.");
  });

  test("works with the keyboard alone, and Escape closes the form", async ({ page, request }) => {
    await openStory(page, request);
    await openItem(page, "Scene A");

    await button(page, "Rename").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("textbox", { name: "New title" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(button(page, "Rename")).toBeFocused();
    await expect(page.getByRole("textbox", { name: "New title" })).toHaveCount(0);

    await page.keyboard.press("Enter");
    await page.keyboard.type("Keyboard title");
    await page.keyboard.press("Enter");
    await expect(outline(page).getByRole("link", { name: "Keyboard title" })).toBeVisible();
    await expect(button(page, "Rename")).toBeFocused();
  });

  test("writing goes on after a rename, with no conflict with the writer's own change", async ({
    page,
    request,
  }) => {
    await openStory(page, request);
    await openItem(page, "Scene A");
    await textBox(page, "Scene A").fill("Waves crash. Typed before the rename.");

    await button(page, "Rename").click();
    await page.keyboard.type("Renamed scene");
    await page.keyboard.press("Enter");
    await expect(outline(page).getByRole("link", { name: "Renamed scene" })).toBeVisible();

    await textBox(page, "Renamed scene").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" Typed after.");
    await page.keyboard.press("ControlOrMeta+s");
    await expect(saved(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Save my text over theirs" })).toHaveCount(0);

    await page.reload();
    await expect(textBox(page, "Renamed scene")).toHaveValue(
      "Waves crash. Typed before the rename. Typed after.",
    );
  });

  test("an empty title is explained and the form stays open", async ({ page, request }) => {
    await openStory(page, request);
    await openItem(page, "Scene A");
    await button(page, "Rename").click();
    await page.getByRole("textbox", { name: "New title" }).fill("   ");
    await page.getByRole("button", { name: "Save title" }).click();

    await expect(page.getByRole("alert")).toContainText("Enter a title.");
    await expect(page.getByRole("textbox", { name: "New title" })).toBeVisible();
    await expect(outline(page).getByRole("link", { name: "Scene A", exact: true })).toBeVisible();
  });

  test("a title over the limit is explained in the API's words, and what was typed stays", async ({
    page,
    request,
  }) => {
    await openStory(page, request);
    await openItem(page, "Scene A");
    await button(page, "Rename").click();
    await page.getByRole("textbox", { name: "New title" }).fill("x".repeat(201));
    await page.keyboard.press("Enter");

    await expect(page.getByRole("alert")).toContainText("at most 200 characters");
    await expect(page.getByRole("textbox", { name: "New title" })).toHaveValue("x".repeat(201));
  });

  test("shows markup, emoji and right-to-left text in a title as text", async ({
    page,
    request,
  }) => {
    await openStory(page, request);
    await openItem(page, "Scene A");
    await button(page, "Rename").click();
    const title = "<b>Bold</b> 😀 שלום";
    await page.getByRole("textbox", { name: "New title" }).fill(title);
    await page.keyboard.press("Enter");

    await expect(outline(page).getByRole("link", { name: title })).toBeVisible();
    await expect(toolbar(page, title)).toBeVisible();
    await expect(page.locator("b")).toHaveCount(0);
  });

  test("renaming to the same title sends nothing and closes the form", async ({
    page,
    request,
  }) => {
    await openStory(page, request);
    await openItem(page, "Scene A");
    let patches = 0;
    await page.route("**/projects/*/documents/*", (route) => {
      if (route.request().method() === "PATCH") patches += 1;
      return route.continue();
    });
    await button(page, "Rename").click();
    await page.getByRole("button", { name: "Save title" }).click();
    await expect(page.getByRole("textbox", { name: "New title" })).toHaveCount(0);
    await expect(button(page, "Rename")).toBeFocused();
    expect(patches).toBe(0);
  });
});

test.describe("moving an item", () => {
  test("Move up and Move down change the order, and the focus stays on the button", async ({
    page,
    request,
  }) => {
    const story = await openStory(page, request);
    await openItem(page, "Scene C");

    // With the keyboard: WebKit does not focus a button that is clicked, so a click could not show
    // where the focus stays.
    await button(page, "Move up").focus();
    await page.keyboard.press("Enter");
    await expect(announced(page, /“Scene C” moved\. It is now 2 of 3 in “Act One”\./)).toHaveCount(
      1,
    );
    await expect
      .poll(() => linkTitles(page))
      .toEqual(["Act One", "Scene A", "Scene C", "Scene B", "Act Two"]);
    await expect(button(page, "Move up")).toBeFocused();
    await expect(outline(page).getByRole("link", { name: "Scene C" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(await serverTitles(request, story)).toEqual([
      "Act One",
      "Scene A",
      "Scene C",
      "Scene B",
      "Act Two",
    ]);

    await button(page, "Move down").click();
    await expect
      .poll(() => linkTitles(page))
      .toEqual(["Act One", "Scene A", "Scene B", "Scene C", "Act Two"]);
    await expect(textBox(page, "Scene C")).toHaveValue("The lamp turns.");
  });

  test("at the end of the list the button is marked unavailable and keeps the focus", async ({
    page,
    request,
  }) => {
    await openStory(page, request);
    await openItem(page, "Scene B");
    await button(page, "Move up").focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(() => linkTitles(page))
      .toEqual(["Act One", "Scene B", "Scene A", "Scene C", "Act Two"]);

    await expect(button(page, "Move up")).toHaveAttribute("aria-disabled", "true");
    await expect(button(page, "Move up")).toBeFocused();
    // Pressing it does nothing.
    await page.keyboard.press("Enter");
    expect(await linkTitles(page)).toEqual(["Act One", "Scene B", "Scene A", "Scene C", "Act Two"]);
    await expect(button(page, "Move down")).not.toHaveAttribute("aria-disabled", "true");
  });

  test("works with the keyboard alone", async ({ page, request }) => {
    await openStory(page, request);
    await openItem(page, "Scene A");
    await button(page, "Move down").focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(() => linkTitles(page))
      .toEqual(["Act One", "Scene B", "Scene A", "Scene C", "Act Two"]);
    await page.keyboard.press("Space");
    await expect
      .poll(() => linkTitles(page))
      .toEqual(["Act One", "Scene B", "Scene C", "Scene A", "Act Two"]);
  });

  test("moves a top-level act among the top-level items", async ({ page, request }) => {
    const story = await openStory(page, request);
    await openItem(page, "Act Two");
    await button(page, "Move up").click();
    await expect
      .poll(() => linkTitles(page))
      .toEqual(["Act Two", "Act One", "Scene A", "Scene B", "Scene C"]);
    expect(await serverTitles(request, story)).toEqual([
      "Act Two",
      "Act One",
      "Scene A",
      "Scene B",
      "Scene C",
    ]);
  });

  test("Move to… moves a scene into another act, and the scene stays open", async ({
    page,
    request,
  }) => {
    const story = await openStory(page, request);
    await openItem(page, "Scene B");

    await button(page, "Move to…").click();
    await expect(page.getByRole("combobox", { name: "Move to" })).toBeFocused();
    await page
      .getByRole("combobox", { name: "Move to" })
      .selectOption({ label: "Inside “Act Two”" });
    await page.getByRole("button", { name: "Move", exact: true }).click();

    await expect
      .poll(() => linkTitles(page))
      .toEqual(["Act One", "Scene A", "Scene C", "Act Two", "Scene B"]);
    await expect(textBox(page, "Scene B")).toHaveValue("The keeper climbs the stairs.");
    await expect(button(page, "Move to…")).toBeFocused();
    expect(await serverTitles(request, story)).toEqual([
      "Act One",
      "Scene A",
      "Scene C",
      "Act Two",
      "Scene B",
    ]);

    await page.reload();
    await expect(textBox(page, "Scene B")).toBeVisible();
    expect(await linkTitles(page)).toEqual(["Act One", "Scene A", "Scene C", "Act Two", "Scene B"]);
  });

  test("Move to… moves a scene out to the top level", async ({ page, request }) => {
    const story = await openStory(page, request);
    await openItem(page, "Scene A");
    await button(page, "Move to…").click();
    await page.getByRole("combobox", { name: "Move to" }).selectOption({ label: "Top level" });
    await page.getByRole("button", { name: "Move", exact: true }).click();

    await expect
      .poll(() => linkTitles(page))
      .toEqual(["Act One", "Scene B", "Scene C", "Act Two", "Scene A"]);
    const entries = await readOutline(request, story.user, story.projectId);
    expect(entries.find((entry) => entry.title === "Scene A")?.parentId).toBeNull();
  });

  test("an act with scenes cannot be moved inside another: there is no Move to…", async ({
    page,
    request,
  }) => {
    await openStory(page, request);
    await openItem(page, "Act One");
    await expect(button(page, "Move down")).toBeVisible();
    await expect(page.getByRole("button", { name: "Move to…" })).toHaveCount(0);
  });

  test("an act without scenes can be moved inside another act", async ({ page, request }) => {
    const story = await openStory(page, request);
    await openItem(page, "Act Two");
    await button(page, "Move to…").click();
    await page
      .getByRole("combobox", { name: "Move to" })
      .selectOption({ label: "Inside “Act One”" });
    await page.getByRole("button", { name: "Move", exact: true }).click();

    // The outline reads the same before and after (Act Two was last, and is now Act One's last
    // scene), so the server is asked: Act Two must now have Act One as its parent.
    await expect
      .poll(async () => {
        const entries = await readOutline(request, story.user, story.projectId);
        return entries.find((entry) => entry.title === "Act Two")?.parentId;
      })
      .toBe(story.ids["Act One"]);
    // Inside Act One it has neighbours above it, so Move up is available (it was the last act).
    await expect(button(page, "Move up")).not.toHaveAttribute("aria-disabled", "true");
    await expect(button(page, "Move down")).toHaveAttribute("aria-disabled", "true");
  });

  test("Cancel and Escape close the move list without moving", async ({ page, request }) => {
    const story = await openStory(page, request);
    await openItem(page, "Scene B");
    await button(page, "Move to…").click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(button(page, "Move to…")).toBeFocused();

    await button(page, "Move to…").click();
    await page.keyboard.press("Escape");
    await expect(button(page, "Move to…")).toBeFocused();
    expect(await serverTitles(request, story)).toEqual(STORY_TITLES);
  });
});

test.describe("deleting an item", () => {
  test("asks first with the safe answer focused, then deletes and closes the text", async ({
    page,
    request,
  }) => {
    const story = await openStory(page, request);
    await openItem(page, "Scene B");

    await button(page, "Delete").click();
    await expect(page.getByRole("group", { name: "Delete “Scene B”?" })).toContainText(
      "cannot be undone",
    );
    await expect(button(page, "Keep item")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(button(page, "Delete")).toBeFocused();
    await expect(textBox(page, "Scene B")).toBeVisible();

    await button(page, "Delete").click();
    await button(page, "Delete item").click();

    await expect(page.getByText("Choose an item in the outline to start writing.")).toBeVisible();
    await expect(textBox(page)).toHaveCount(0);
    await expect(outline(page).getByRole("heading", { level: 2, name: "Outline" })).toBeFocused();
    await expect(announced(page, /“Scene B” was deleted\./)).toHaveCount(1);
    await expect.poll(() => linkTitles(page)).toEqual(["Act One", "Scene A", "Scene C", "Act Two"]);
    expect(await serverTitles(request, story)).toEqual([
      "Act One",
      "Scene A",
      "Scene C",
      "Act Two",
    ]);
    expect(page.url()).not.toContain("document=");

    await page.reload();
    await expect(page.getByText("Choose an item in the outline to start writing.")).toBeVisible();
  });

  test("deletes an act together with its scenes, after saying how many go", async ({
    page,
    request,
  }) => {
    const story = await openStory(page, request);
    await openItem(page, "Act One");
    await button(page, "Delete").click();
    await expect(page.getByRole("group", { name: "Delete “Act One”?" })).toContainText(
      "Its 3 scenes and all of their text are deleted too",
    );
    await button(page, "Delete item").click();

    await expect.poll(() => linkTitles(page)).toEqual(["Act Two"]);
    expect(await serverTitles(request, story)).toEqual(["Act Two"]);
  });

  test("Keep leaves everything as it was", async ({ page, request }) => {
    const story = await openStory(page, request);
    await openItem(page, "Scene B");
    await button(page, "Delete").click();
    await button(page, "Keep item").click();
    await expect(button(page, "Delete")).toBeFocused();
    expect(await serverTitles(request, story)).toEqual(STORY_TITLES);
  });

  test("an item already deleted elsewhere is simply gone", async ({ page, request }) => {
    const story = await openStory(page, request);
    await openItem(page, "Scene B");
    await deleteDocument(request, story.user, story.projectId, story.ids["Scene B"] ?? "");

    await button(page, "Delete").click();
    await button(page, "Delete item").click();

    await expect(page.getByText("Choose an item in the outline to start writing.")).toBeVisible();
    await expect.poll(() => linkTitles(page)).toEqual(["Act One", "Scene A", "Scene C", "Act Two"]);
  });

  test("when the delete cannot be sent, the question stays with the reason, and the text keeps saving", async ({
    page,
    request,
  }) => {
    await openStory(page, request);
    await openItem(page, "Scene B");
    await page.route("**/projects/*/documents/*", (route) =>
      route.request().method() === "DELETE" ? route.abort("failed") : route.continue(),
    );

    await button(page, "Delete").click();
    await button(page, "Delete item").click();
    await expect(page.getByRole("alert")).toContainText("Can't reach the server.");
    await expect(button(page, "Delete item")).toBeVisible();

    await button(page, "Keep item").click();
    await textBox(page, "Scene B").fill("Still here, and still saved.");
    await page.keyboard.press("ControlOrMeta+s");
    await expect(saved(page)).toBeVisible();
    await page.reload();
    await expect(textBox(page, "Scene B")).toHaveValue("Still here, and still saved.");
  });
});

test.describe("when things go wrong while changing the outline", () => {
  test("offline: a rename says why, keeps the form, and works when the connection is back", async ({
    page,
    request,
  }) => {
    await openStory(page, request);
    await openItem(page, "Scene A");
    await page.route("**/projects/*/documents/*", (route) =>
      route.request().method() === "PATCH" ? route.abort("failed") : route.continue(),
    );

    await button(page, "Rename").click();
    await page.keyboard.type("Back online");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toContainText("Can't reach the server.");
    await expect(page.getByRole("textbox", { name: "New title" })).toHaveValue("Back online");

    // The focus is on the list of problems; the writer presses Save title again.
    await expect(page.getByRole("alert")).toBeFocused();
    await page.unroute("**/projects/*/documents/*");
    await page.getByRole("button", { name: "Save title" }).click();
    await expect(outline(page).getByRole("link", { name: "Back online" })).toBeVisible();
    await expect(button(page, "Rename")).toBeFocused();
  });

  test("another tab changed the item first: nothing is renamed and the writer chooses", async ({
    page,
    context,
    request,
  }) => {
    const story = await openStory(page, request);
    await openItem(page, "Scene A");

    // A second tab opens the same item and saves a newer text.
    const other = await context.newPage();
    await other.goto(page.url());
    await expect(textBox(other, "Scene A")).toBeVisible();
    await textBox(other, "Scene A").fill("Newer text from the other tab.");
    await other.keyboard.press("ControlOrMeta+s");
    await expect(saved(other)).toBeVisible();

    // The first tab renames: the item has a newer version, so the rename is refused.
    await button(page, "Rename").click();
    await page.keyboard.type("Too late");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert").first()).toContainText("nothing was renamed");
    expect(await serverTitles(request, story)).toContain("Scene A");

    // The writer decides in the notice; afterwards the rename works.
    await page.getByRole("button", { name: "Load the newer text (discard mine)" }).click();
    await expect(textBox(page, "Scene A")).toHaveValue("Newer text from the other tab.");
    await page.getByRole("button", { name: "Cancel" }).click();
    await button(page, "Rename").click();
    await page.keyboard.type("Now it works");
    await page.keyboard.press("Enter");
    await expect(outline(page).getByRole("link", { name: "Now it works" })).toBeVisible();
  });

  test("a rename in another tab makes this tab's next save a conflict, and the title stays renamed", async ({
    page,
    context,
    request,
  }) => {
    const story = await openStory(page, request);
    await openItem(page, "Scene A");

    const other = await context.newPage();
    await other.goto(page.url());
    await expect(textBox(other, "Scene A")).toBeVisible();
    await button(other, "Rename").click();
    await other.keyboard.type("Renamed elsewhere");
    await other.keyboard.press("Enter");
    await expect(other.getByRole("heading", { level: 2, name: "Renamed elsewhere" })).toBeVisible();

    await textBox(page, "Scene A").fill("My text.");
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByRole("alert")).toContainText("This text was changed somewhere else.");
    await page.getByRole("button", { name: "Save my text over theirs" }).click();
    await expect(saved(page)).toBeVisible();

    const entries = await readOutline(request, story.user, story.projectId);
    expect(entries.map((entry) => entry.title)).toContain("Renamed elsewhere");
    await page.reload();
    await expect(textBox(page, "Renamed elsewhere")).toHaveValue("My text.");
  });
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`axe on the item toolbar in ${colorScheme} mode (colour contrast included)`, () => {
    test.use({ colorScheme });

    test("buttons, rename form, move list and delete question", async ({ page, request }) => {
      await openStory(page, request);
      await openItem(page, "Scene B");
      await expectNoAxeViolations(page);

      await button(page, "Rename").click();
      await expectNoAxeViolations(page);
      await page.getByRole("button", { name: "Save title" }).click();
      await expect(button(page, "Rename")).toBeFocused();

      await button(page, "Rename").click();
      await page.getByRole("textbox", { name: "New title" }).fill("");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("alert")).toBeVisible();
      await expectNoAxeViolations(page);
      await page.getByRole("button", { name: "Cancel" }).click();

      await button(page, "Move to…").click();
      await expectNoAxeViolations(page);
      await page.getByRole("button", { name: "Cancel" }).click();

      await button(page, "Delete").click();
      await expectNoAxeViolations(page);
    });
  });
}

test.describe("the item toolbar on a phone-sized screen (320 px wide)", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("a 200-character title and every form fit, and nothing pushes the page sideways", async ({
    page,
    request,
  }) => {
    const long = "T".repeat(200);
    await openStory(page, request, [
      { title: long, content: "Text." },
      { title: "A scene", inside: long },
      { title: "Another act" },
    ]);
    await openItem(page, "A scene");

    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    expect(await overflow()).toBeLessThanOrEqual(0);

    await button(page, "Move to…").click();
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page
      .getByRole("combobox", { name: "Move to" })
      .selectOption({ label: `Inside “Another act”` });
    await page.getByRole("button", { name: "Cancel" }).click();

    await button(page, "Rename").click();
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.getByRole("button", { name: "Cancel" }).click();

    await button(page, "Delete").click();
    expect(await overflow()).toBeLessThanOrEqual(0);
  });

  test("every button, field and list of the toolbar is at least 24 by 24 pixels", async ({
    page,
    request,
  }) => {
    await openStory(page, request);
    await openItem(page, "Scene B");
    const tooSmall = () =>
      page
        .locator("fieldset button, fieldset input:not([type=hidden]), fieldset select")
        .evaluateAll((elements) =>
          elements
            .map((element) => ({
              html: element.outerHTML.slice(0, 100),
              box: element.getBoundingClientRect(),
            }))
            .filter(({ box }) => box.width > 0 && (box.width < 24 || box.height < 24))
            .map(
              ({ html, box }) => `${html} is ${Math.round(box.width)}x${Math.round(box.height)}`,
            ),
        );
    expect(await tooSmall()).toEqual([]);

    await button(page, "Rename").click();
    expect(await tooSmall()).toEqual([]);
    await page.getByRole("button", { name: "Cancel" }).click();
    await button(page, "Move to…").click();
    expect(await tooSmall()).toEqual([]);
    await page.getByRole("button", { name: "Cancel" }).click();
    await button(page, "Delete").click();
    expect(await tooSmall()).toEqual([]);
  });
});
