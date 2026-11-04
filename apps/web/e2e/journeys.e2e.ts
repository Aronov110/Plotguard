import { expect, test } from "@playwright/test";
import { createAccount } from "./support/api-control.ts";
import {
  logIn,
  PROJECTS_HEADING,
  signOut,
  signUp,
  submitLoginForm,
  submitSignUpForm,
} from "./support/flows.ts";
import { uniqueUser } from "./support/users.ts";

const WRONG_LOGIN = "Email or password is incorrect.";

test.describe("signing up, staying signed in, signing out and signing in", () => {
  test("a new person signs up, survives a reload, signs out and signs in again", async ({
    page,
  }) => {
    const user = uniqueUser();

    await signUp(page, user);
    await expect(page.getByText("Signed in as")).toBeVisible();
    await expect(page.getByText(user.displayName, { exact: true })).toBeVisible();

    // The login is restored from the cookies, through the proxy.
    await page.reload();
    await expect(page.getByRole("heading", PROJECTS_HEADING)).toBeVisible();
    await expect(page.getByText(user.displayName, { exact: true })).toBeVisible();

    await signOut(page);
    await page.reload();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { level: 1, name: "Log in" })).toBeVisible();

    await logIn(page, user);
  });

  test("without a display name the email is shown instead", async ({ page }) => {
    const user = uniqueUser();
    await page.goto("/register");
    await submitSignUpForm(page, user, { withDisplayName: false });
    await expect(page.getByRole("heading", PROJECTS_HEADING)).toBeVisible();
    await expect(page.getByText(user.email, { exact: true })).toBeVisible();
  });

  test("no history entry leads back to the signed-in screen after signing out", async ({
    page,
  }) => {
    // History before: the landing page, then the signed-in home. Signing out replaces the home
    // entry with the login screen, so neither Back nor Forward can show private content again.
    await page.goto("/");
    await signUp(page, uniqueUser());
    await signOut(page);

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", PROJECTS_HEADING)).toHaveCount(0);

    await page.goForward();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", PROJECTS_HEADING)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  });

  test("a signed-out visit to /app goes to the login screen and returns to /app after login", async ({
    page,
    request,
  }) => {
    const user = uniqueUser();
    await createAccount(request, user);

    await page.goto("/app");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", PROJECTS_HEADING)).toHaveCount(0);

    await logIn(page, user);
  });

  test("the return address survives a detour through the sign-up screen", async ({ page }) => {
    const user = uniqueUser();
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login$/);
    await page.getByRole("link", { name: "Create one" }).click();
    await expect(page).toHaveURL(/\/register$/);
    await submitSignUpForm(page, user);
    await expect(page).toHaveURL(/\/app$/);
  });

  test("a second tab of the same browser is signed out too", async ({ page, context }) => {
    const user = uniqueUser();
    await signUp(page, user);

    const second = await context.newPage();
    await second.goto("/app");
    await expect(second.getByRole("heading", PROJECTS_HEADING)).toBeVisible();

    await signOut(page);
    await expect(second).toHaveURL(/\/login$/);
  });
});

test.describe("a sign-out the server could not confirm", () => {
  test("says so, keeps the login cookie visible to the browser, and the retry works", async ({
    page,
    context,
  }) => {
    const user = uniqueUser();
    await signUp(page, user);

    await page.route("**/auth/logout", (route) => route.abort("failed"));
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    const notice = page.getByRole("status").filter({ hasText: "could not confirm" });
    await expect(notice).toBeVisible();
    // The page cannot delete an HttpOnly cookie, which is exactly why the notice exists.
    expect((await context.cookies()).some((cookie) => cookie.name === "refresh_token")).toBe(true);

    await page.unroute("**/auth/logout");
    await page.getByRole("button", { name: "Try signing out again" }).click();
    await expect(notice).toBeHidden();
    await expect
      .poll(async () => (await context.cookies()).some((cookie) => cookie.name === "refresh_token"))
      .toBe(false);
  });
});

test.describe("what the forms say when something is wrong", () => {
  test("a wrong password gets one fixed sentence, shown in a focused alert", async ({
    page,
    request,
  }) => {
    const user = uniqueUser();
    await createAccount(request, user);

    await page.goto("/login");
    await submitLoginForm(page, user.email, "not the right password");

    const alert = page.getByRole("alert");
    await expect(alert).toContainText(WRONG_LOGIN);
    await expect(alert).toBeFocused();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("an unknown email gets exactly the same sentence as a wrong password", async ({ page }) => {
    await page.goto("/login");
    await submitLoginForm(page, uniqueUser().email, "whatever password");

    await expect(page.getByRole("alert")).toContainText(WRONG_LOGIN);
    await expect(page.getByRole("alert").getByRole("listitem")).toHaveCount(1);
  });

  test("empty fields are named, and a link in the summary moves the focus to the field", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Log in" }).click();

    const alert = page.getByRole("alert");
    await expect(alert).toBeFocused();
    await expect(alert.getByRole("link", { name: "Enter your email address." })).toBeVisible();
    await expect(alert.getByRole("link", { name: "Enter your password." })).toBeVisible();

    await alert.getByRole("link", { name: "Enter your email address." }).click();
    await expect(page.getByLabel("Email")).toBeFocused();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("a sign-up with an email that is taken says so next to the email field", async ({
    page,
    request,
  }) => {
    const user = uniqueUser();
    await createAccount(request, user);

    await page.goto("/register");
    await submitSignUpForm(page, { ...user, password: "another long password" });

    await expect(page.getByRole("alert")).toContainText("That email is already registered.");
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(/\/register$/);
  });

  test("a password that is too short shows the API's own message", async ({ page }) => {
    await page.goto("/register");
    await submitSignUpForm(page, { ...uniqueUser(), password: "short" });

    await expect(page.getByRole("alert")).toContainText(/at least 12 characters/i);
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(page).toHaveURL(/\/register$/);
  });

  test("an address that is not an email shows a problem and stays on the form", async ({
    page,
  }) => {
    await page.goto("/register");
    await submitSignUpForm(page, { ...uniqueUser(), email: "not-an-email" });

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(/\/register$/);
  });

  test("the problem message goes away after a correct submit", async ({ page }) => {
    const user = uniqueUser();
    await page.goto("/register");
    await submitSignUpForm(page, { ...user, password: "short" });
    await expect(page.getByRole("alert")).toBeVisible();

    await page.getByLabel("Password", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", PROJECTS_HEADING)).toBeVisible();
  });

  test("the server being unreachable is explained in plain words", async ({ page }) => {
    await page.route("**/auth/login", (route) => route.abort("failed"));
    await page.goto("/login");
    await submitLoginForm(page, uniqueUser().email, "whatever password");

    await expect(page.getByRole("alert")).toContainText("Can't reach the server.");
  });

  test("an answer the page does not know is shown as a fixed sentence, never as raw text", async ({
    page,
  }) => {
    await page.route("**/auth/login", (route) =>
      route.fulfill({
        status: 500,
        contentType: "text/html",
        body: "<script>window.hacked = true</script><b>boom</b>",
      }),
    );
    await page.goto("/login");
    await submitLoginForm(page, uniqueUser().email, "whatever password");

    await expect(page.getByRole("alert")).toContainText("Something went wrong. Please try again.");
    await expect(page.getByRole("alert")).not.toContainText("boom");
    expect(await page.evaluate(() => "hacked" in window)).toBe(false);
  });
});

test.describe("what is typed is what is sent", () => {
  test("a password with spaces and an emoji is kept exactly, and a trimmed copy is wrong", async ({
    page,
  }) => {
    const user = { ...uniqueUser(), password: "  pä ss 🔑 wörd  " };

    await signUp(page, user);
    await signOut(page);

    await submitLoginForm(page, user.email, user.password.trim());
    await expect(page.getByRole("alert")).toContainText(WRONG_LOGIN);

    await submitLoginForm(page, user.email, user.password);
    await expect(page.getByRole("heading", PROJECTS_HEADING)).toBeVisible();
  });

  test("two quick clicks on the sign-up button send one request", async ({ page }) => {
    let requests = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/auth/register")) requests += 1;
    });

    const user = uniqueUser();
    await page.goto("/register");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Create account" }).dblclick();

    await expect(page.getByRole("heading", PROJECTS_HEADING)).toBeVisible();
    expect(requests).toBe(1);
  });

  test("the password can be shown and hidden again", async ({ page }) => {
    await page.goto("/login");
    const password = page.getByLabel("Password", { exact: true });
    const toggle = page.getByRole("button", { name: "Show password" });

    await password.fill("a secret value");
    await expect(password).toHaveAttribute("type", "password");
    await toggle.click();
    await expect(password).toHaveAttribute("type", "text");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(password).toHaveAttribute("spellcheck", "false");
    await expect(password).toHaveValue("a secret value");
    await toggle.click();
    await expect(password).toHaveAttribute("type", "password");
  });
});

test.describe("the other screens", () => {
  test("the landing page offers sign-up and login, then the app once signed in", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Plotpal" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create account" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();

    await signUp(page, uniqueUser());
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Go to your projects" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create account" })).toHaveCount(0);
  });

  test("someone who is signed in is moved on from the login and sign-up screens", async ({
    page,
  }) => {
    await signUp(page, uniqueUser());

    await page.goto("/login");
    await expect(page).toHaveURL(/\/app$/);
    await page.goto("/register");
    await expect(page).toHaveURL(/\/app$/);
  });

  test("an unknown address shows the not-found screen, which leads home", async ({ page }) => {
    await page.goto("/there-is-nothing-here");
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    await expect(page).toHaveTitle("Page not found – Plotpal");
    await expect(page.getByText("there-is-nothing-here")).toHaveCount(0);

    await page.getByRole("link", { name: "Go to the home page" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Plotpal" })).toBeVisible();
  });
});
