import { expect, test } from "@playwright/test";
import { createAccount } from "./support/api-control.ts";
import { logIn } from "./support/flows.ts";
import { WEB_ORIGIN } from "./support/targets.ts";
import { uniqueUser } from "./support/users.ts";

test.describe("which addresses belong to the API", () => {
  test("/auth/me is answered by the API as JSON, not by the web app", async ({ request }) => {
    const response = await request.get(`${WEB_ORIGIN}/auth/me`);
    expect(response.status()).toBe(401);
    expect(response.headers()["content-type"]).toContain("json");
  });

  test("a bare /auth is not the web app's page either", async ({ request }) => {
    const response = await request.get(`${WEB_ORIGIN}/auth`);
    expect(response.headers()["content-type"]).not.toContain("text/html");
  });

  test.describe("page addresses that only start with the letters 'auth'", () => {
    for (const path of ["/authors", "/auth-callback", "/authentication"]) {
      test(`${path} is a screen of the web app, not the API`, async ({ page }) => {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
      });
    }
  });
});

test.describe("the API's origin check, through the proxy", () => {
  const credentials = () => ({ email: uniqueUser().email, password: uniqueUser().password });

  test("a call that says it comes from another site is refused", async ({ request }) => {
    const response = await request.post(`${WEB_ORIGIN}/auth/login`, {
      headers: { Origin: "https://evil.example" },
      data: credentials(),
    });
    expect(response.status()).toBe(403);
  });

  test("a call without an Origin header is refused", async ({ request }) => {
    const response = await request.post(`${WEB_ORIGIN}/auth/login`, { data: credentials() });
    expect(response.status()).toBe(403);
  });

  test("a call from the web app's own origin reaches the login check", async ({ request }) => {
    const response = await request.post(`${WEB_ORIGIN}/auth/login`, {
      headers: { Origin: WEB_ORIGIN },
      data: credentials(),
    });
    // 401 means it got past the origin check and failed on the unknown account.
    expect(response.status()).toBe(401);
  });
});

test.describe("the screens that need a login", () => {
  test("/app shows no private content while signed out", async ({ page }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText("Your projects")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  });

  test("a return address cannot be planted in the web address", async ({ page, request }) => {
    // The address a person is sent back to is kept in the history state, never in the query.
    const user = uniqueUser();
    await createAccount(request, user);

    await page.goto(
      "/login?from=https://evil.example&next=//evil.example&returnTo=/\\evil.example",
    );
    await logIn(page, user);
    expect(new URL(page.url()).origin).toBe(WEB_ORIGIN);
    expect(new URL(page.url()).pathname).toBe("/app");
  });
});
