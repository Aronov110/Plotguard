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

// The API behind these tests answers with a fake AI model (see apps/api/src/test-support/e2e-server.ts):
// no key, no network, no cost. A test tells it what to do next with `aiNext`. The first poll of a
// run comes after two seconds, so waits for a result are generous.
const RESULT_TIMEOUT = 20_000;

const STORY: readonly SeedDocument[] = [
  { title: "Act One", content: "The lighthouse stands alone." },
  { title: "The Storm", inside: "Act One", content: "Waves crash on the rocks." },
];

const toggle = (page: Page) => page.getByRole("button", { name: /Plot-hole finder/ });
const runButton = (page: Page) => page.getByRole("button", { name: "Run the scan" });
const findings = (page: Page) => page.getByRole("list", { name: "Findings" });

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

test.describe("the plot-hole finder", () => {
  // A held run must never leak into the next test.
  test.afterEach(async ({ request }) => {
    await releaseAi(request);
  });

  test("is closed at first, and opens with the cost and the privacy notice beside Run", async ({
    page,
    request,
  }) => {
    await openStory(page, request);
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
    await expect(runButton(page)).toBeHidden();

    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText(/Costs about/)).toBeVisible();
    await expect(page.getByText(/sent to Anthropic/)).toBeVisible();
    await expect(runButton(page)).toBeVisible();
    await expect(page.getByText("No earlier scans.")).toBeVisible();
  });

  test("scans the whole project and shows findings whose quote links into the text", async ({
    page,
    request,
  }) => {
    await openStory(page, request);
    await toggle(page).click();
    await runButton(page).click();

    await expect(page.getByRole("progressbar", { name: "The scan is running" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel the scan" })).toBeVisible();

    await expect(findings(page)).toBeVisible({ timeout: RESULT_TIMEOUT });
    await expect(page.getByText("Found in your text.").first()).toBeVisible();
    await expect(page.getByText("The scan has finished.")).toBeAttached();

    // The quote is in "Act One": its link opens that item.
    await findings(page).getByRole("link", { name: "Act One" }).first().click();
    await expect(page).toHaveURL(/\?document=/);
    await expect(page.getByRole("textbox", { name: "Text of “Act One”" })).toHaveValue(
      "The lighthouse stands alone.",
    );
  });

  test("reads the open item by default", async ({ page, request }) => {
    await openStory(page, request);
    await page
      .getByRole("navigation", { name: "Outline" })
      .getByRole("link", { name: /The Storm/ })
      .click();
    await expect(page.getByRole("textbox", { name: "Text of “The Storm”" })).toBeVisible();

    await toggle(page).click();
    await expect(page.getByRole("radio", { name: "The open item: “The Storm”" })).toBeChecked();
    await runButton(page).click();
    await expect(page.getByRole("heading", { level: 3, name: /^Scan of “The Storm”/ })).toBeVisible(
      { timeout: RESULT_TIMEOUT },
    );
  });

  test("can be cancelled while it runs", async ({ page, request }) => {
    await openStory(page, request);
    await aiNext(request, "hold");
    await toggle(page).click();
    await runButton(page).click();

    await page.getByRole("button", { name: "Cancel the scan" }).click();
    await expect(page.getByText("You cancelled this scan.")).toBeVisible();
    await expect(page.getByRole("progressbar")).toBeHidden();
    await expect(runButton(page)).toBeEnabled();
  });

  test("explains a scan the AI declined, in plain words", async ({ page, request }) => {
    await openStory(page, request);
    await aiNext(request, "refused");
    await toggle(page).click();
    await runButton(page).click();
    await expect(page.getByText(/The AI declined to read this text/)).toBeVisible({
      timeout: RESULT_TIMEOUT,
    });
  });

  test("finds a scan that is still running after the page is reloaded, and shows its result", async ({
    page,
    request,
  }) => {
    await openStory(page, request);
    await aiNext(request, "hold");
    await toggle(page).click();
    await runButton(page).click();
    await expect(page.getByRole("progressbar")).toBeVisible();

    await page.reload();
    await toggle(page).click();
    await expect(page.getByRole("progressbar")).toBeVisible();

    await releaseAi(request);
    await expect(findings(page)).toBeVisible({ timeout: RESULT_TIMEOUT });
  });

  test("keeps earlier scans, which can be opened and deleted", async ({ page, request }) => {
    await openStory(page, request);
    await toggle(page).click();
    await runButton(page).click();
    await expect(findings(page)).toBeVisible({ timeout: RESULT_TIMEOUT });

    await page.reload();
    await toggle(page).click();
    await page.getByRole("button", { name: /^Open the scan of the whole project/ }).click();
    await expect(findings(page)).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 3, name: /^Scan of the whole project/ }),
    ).toBeFocused();

    await page.getByRole("button", { name: /^Delete the scan of the whole project/ }).click();
    await expect(page.getByRole("button", { name: "Keep scan" })).toBeFocused();
    await page.getByRole("button", { name: "Delete scan" }).click();
    await expect(page.getByText("No earlier scans.")).toBeVisible();
  });

  test("works from the keyboard", async ({ page, request }) => {
    await openStory(page, request);
    await toggle(page).focus();
    await page.keyboard.press("Enter");
    await expect(runButton(page)).toBeVisible();
    await runButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(findings(page)).toBeVisible({ timeout: RESULT_TIMEOUT });
  });

  test("has no accessibility violations open, running and with a result", async ({
    page,
    request,
  }) => {
    await openStory(page, request);
    await aiNext(request, "hold");
    await toggle(page).click();
    await expectNoAxeViolations(page);

    await runButton(page).click();
    await expect(page.getByRole("progressbar")).toBeVisible();
    await expectNoAxeViolations(page);

    await releaseAi(request);
    await expect(findings(page)).toBeVisible({ timeout: RESULT_TIMEOUT });
    await expectNoAxeViolations(page);
  });
});
