import { expect, type Page, test } from "@playwright/test";
import {
  aiNext,
  createAccount,
  createProjectWithDocuments,
  releaseAi,
  type SeedDocument,
} from "./support/api-control.ts";
import { expectNoAxeViolations } from "./support/axe.ts";
import { logIn } from "./support/flows.ts";
import { uniqueUser } from "./support/users.ts";

// The idea generator in the AI panel, against the API with the fake AI model (see
// apps/api/src/test-support/e2e-server.ts): no key, no network, no cost. The fake answers an idea
// request with one idea that quotes the start of the first item and could go into that item.
const RESULT_TIMEOUT = 20_000;

const STORY: readonly SeedDocument[] = [
  { title: "Act One", content: "The lighthouse stands alone." },
  { title: "The Storm", inside: "Act One", content: "Waves crash on the rocks." },
];

const toggle = (page: Page) => page.getByRole("button", { name: /AI assistant/ });
const ideasChoice = (page: Page) => page.getByRole("radio", { name: "Get ideas" });
const plotHolesChoice = (page: Page) => page.getByRole("radio", { name: "Find plot holes" });
const getIdeasButton = (page: Page) => page.getByRole("button", { name: "Get ideas" });
const scanButton = (page: Page) => page.getByRole("button", { name: "Run the scan" });
const focusBox = (page: Page) =>
  page.getByRole("textbox", { name: /What should the ideas be about/ });
const ideasList = (page: Page) => page.getByRole("list", { name: "Ideas" });

async function openStory(page: Page, request: Parameters<typeof createAccount>[0]) {
  const user = uniqueUser();
  await createAccount(request, user);
  const seeded = await createProjectWithDocuments(request, user, {
    title: "The Lighthouse",
    documents: STORY,
  });
  await page.goto("/login");
  await logIn(page, user);
  await page.goto(`/app/projects/${seeded.projectId}`);
  await expect(page.getByRole("heading", { level: 1, name: "The Lighthouse" })).toBeVisible();
  return { user, ...seeded };
}

test.describe("the idea generator", () => {
  // A held run must never leak into the next test.
  test.afterEach(async ({ request }) => {
    await releaseAi(request);
  });

  test("offers the two choices, and shows the focus field only for ideas", async ({
    page,
    request,
  }) => {
    await openStory(page, request);
    await toggle(page).click();
    await expect(plotHolesChoice(page)).toBeChecked();
    await expect(focusBox(page)).toBeHidden();

    await ideasChoice(page).check();
    await expect(focusBox(page)).toBeVisible();
    await expect(getIdeasButton(page)).toBeVisible();
    await expect(scanButton(page)).toBeHidden();
    await expect(page.getByText(/and the focus if you write one/)).toBeVisible();

    await plotHolesChoice(page).check();
    await expect(focusBox(page)).toBeHidden();
    await expect(scanButton(page)).toBeVisible();
  });

  test("counts the focus, and stops Run when it is too long", async ({ page, request }) => {
    await openStory(page, request);
    await toggle(page).click();
    await ideasChoice(page).check();

    await focusBox(page).fill("a stronger ending");
    await expect(page.getByText("17 of 500 characters.")).toBeVisible();

    await focusBox(page).fill("a".repeat(501));
    await expect(page.getByText(/1 character too long/)).toBeVisible();
    await expect(getIdeasButton(page)).toBeDisabled();

    await focusBox(page).fill("a".repeat(500));
    await expect(getIdeasButton(page)).toBeEnabled();
  });

  test("gives ideas with the focus shown, a quote that is found, and links into the text", async ({
    page,
    request,
  }) => {
    await openStory(page, request);
    await toggle(page).click();
    await ideasChoice(page).check();
    await focusBox(page).fill("how the lighthouse could change");
    await getIdeasButton(page).click();

    await expect(
      page.getByRole("progressbar", { name: "The idea request is running" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel the request" })).toBeVisible();

    await expect(ideasList(page)).toBeVisible({ timeout: RESULT_TIMEOUT });
    await expect(
      page.getByRole("heading", { level: 4, name: "Let the first scene come back changed" }),
    ).toBeVisible();
    await expect(page.getByText("Scene", { exact: true })).toBeVisible();
    await expect(page.getByText("Found in your text.").first()).toBeVisible();
    await expect(page.getByText("The ideas are ready.")).toBeAttached();
    await expect(page.locator("p", { hasText: "You asked for ideas about:" })).toContainText(
      "how the lighthouse could change",
    );
    // The text stays for the next run.
    await expect(focusBox(page)).toHaveValue("how the lighthouse could change");

    // "Could go in" and the quote both point at "Act One", the first item.
    await ideasList(page).getByRole("link", { name: "Act One" }).last().click();
    await expect(page).toHaveURL(/\?document=/);
    await expect(page.getByRole("textbox", { name: "Text of “Act One”" })).toHaveValue(
      "The lighthouse stands alone.",
    );
  });

  test("an idea's link moves the focus into the text, also when that item is already open", async ({
    page,
    request,
  }) => {
    await openStory(page, request);
    await page
      .getByRole("navigation", { name: "Outline" })
      .getByRole("link", { name: /Act One/ })
      .click();
    const text = page.getByRole("textbox", { name: "Text of “Act One”" });
    await expect(text).toBeFocused();

    await toggle(page).click();
    await ideasChoice(page).check();
    await getIdeasButton(page).click();
    await expect(ideasList(page)).toBeVisible({ timeout: RESULT_TIMEOUT });
    await expect(text).not.toBeFocused();

    await ideasList(page).getByRole("link", { name: "Act One" }).first().click();
    await expect(text).toBeFocused();
  });

  test("keeps both kinds in the history, each named for what it was", async ({ page, request }) => {
    await openStory(page, request);
    await toggle(page).click();
    await scanButton(page).click();
    await expect(page.getByRole("list", { name: "Findings" })).toBeVisible({
      timeout: RESULT_TIMEOUT,
    });
    await ideasChoice(page).check();
    await getIdeasButton(page).click();
    await expect(ideasList(page)).toBeVisible({ timeout: RESULT_TIMEOUT });

    await page.reload();
    await toggle(page).click();
    const rows = page
      .getByRole("list")
      .filter({ hasText: "the whole project" })
      .getByRole("listitem");
    await expect(rows.filter({ hasText: /Ideas, the whole project, 1 idea/ })).toHaveCount(1);
    await expect(rows.filter({ hasText: /Plot holes, the whole project, 1 finding/ })).toHaveCount(
      1,
    );

    await page.getByRole("button", { name: /^Open the ideas for the whole project/ }).click();
    await expect(ideasList(page)).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 3, name: /^Ideas for the whole project/ }),
    ).toBeFocused();

    await page.getByRole("button", { name: /^Delete the ideas for the whole project/ }).click();
    await expect(page.getByRole("button", { name: "Keep ideas" })).toBeFocused();
    await page.getByRole("button", { name: "Delete ideas" }).click();
    await expect(rows.filter({ hasText: /Ideas, the whole project/ })).toHaveCount(0);
    await expect(rows.filter({ hasText: /Plot holes, the whole project/ })).toHaveCount(1);
  });

  test("can be cancelled while it runs", async ({ page, request }) => {
    await openStory(page, request);
    await aiNext(request, "hold");
    await toggle(page).click();
    await ideasChoice(page).check();
    await getIdeasButton(page).click();

    // The choices are locked while the request goes.
    await expect(plotHolesChoice(page)).toBeDisabled();
    await expect(focusBox(page)).toBeDisabled();

    await page.getByRole("button", { name: "Cancel the request" }).click();
    await expect(page.getByText("You cancelled this idea request.")).toBeVisible();
    await expect(page.getByRole("progressbar")).toBeHidden();
    await expect(getIdeasButton(page)).toBeEnabled();
    await expect(plotHolesChoice(page)).toBeEnabled();
  });

  test("explains an idea request the AI declined, in plain words", async ({ page, request }) => {
    await openStory(page, request);
    await aiNext(request, "refused");
    await toggle(page).click();
    await ideasChoice(page).check();
    await getIdeasButton(page).click();
    await expect(page.getByText(/The AI declined to read this text/)).toBeVisible({
      timeout: RESULT_TIMEOUT,
    });
  });

  test("finds an idea request that is still running after a reload, in its own mode", async ({
    page,
    request,
  }) => {
    await openStory(page, request);
    await aiNext(request, "hold");
    await toggle(page).click();
    await ideasChoice(page).check();
    await getIdeasButton(page).click();
    await expect(page.getByRole("progressbar")).toBeVisible();

    await page.reload();
    await toggle(page).click();
    await expect(
      page.getByRole("progressbar", { name: "The idea request is running" }),
    ).toBeVisible();
    await expect(ideasChoice(page)).toBeChecked();

    await releaseAi(request);
    await expect(ideasList(page)).toBeVisible({ timeout: RESULT_TIMEOUT });
  });

  test("works from the keyboard", async ({ page, request }) => {
    await openStory(page, request);
    await toggle(page).focus();
    await page.keyboard.press("Enter");
    await plotHolesChoice(page).focus();
    await page.keyboard.press("ArrowDown");
    await expect(ideasChoice(page)).toBeChecked();
    await focusBox(page).focus();
    await page.keyboard.type("the ending");
    await getIdeasButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(ideasList(page)).toBeVisible({ timeout: RESULT_TIMEOUT });
  });

  test("has no accessibility violations in ideas mode: open, too long, running and with a result", async ({
    page,
    request,
  }) => {
    await openStory(page, request);
    await aiNext(request, "hold");
    await toggle(page).click();
    await ideasChoice(page).check();
    await expectNoAxeViolations(page);

    await focusBox(page).fill("a".repeat(501));
    await expectNoAxeViolations(page);
    await focusBox(page).fill("the ending");

    await getIdeasButton(page).click();
    await expect(page.getByRole("progressbar")).toBeVisible();
    await expectNoAxeViolations(page);

    await releaseAi(request);
    await expect(ideasList(page)).toBeVisible({ timeout: RESULT_TIMEOUT });
    await expectNoAxeViolations(page);
  });
});
