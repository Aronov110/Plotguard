import { expect, type Page } from "@playwright/test";
import type { TestUser } from "./users.ts";

export const PROJECTS_HEADING = { level: 1, name: "Your projects" } as const;

/** Fills in the sign-up form and presses the button, without waiting for the result. */
export async function submitSignUpForm(
  page: Page,
  user: TestUser,
  options: { readonly withDisplayName?: boolean } = {},
): Promise<void> {
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  if (options.withDisplayName ?? true) await page.getByLabel("Display name").fill(user.displayName);
  await page.getByRole("button", { name: "Create account" }).click();
}

/** Signs up through the form and waits until the signed-in home shows. */
export async function signUp(
  page: Page,
  user: TestUser,
  options: { readonly withDisplayName?: boolean } = {},
): Promise<void> {
  await page.goto("/register");
  await submitSignUpForm(page, user, options);
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", PROJECTS_HEADING)).toBeVisible();
}

/** Fills in the login form (the page must be on /login) and presses the button. */
export async function submitLoginForm(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

/** Logs in through the form (the page must be on /login) and waits for the signed-in home. */
export async function logIn(page: Page, user: TestUser): Promise<void> {
  await submitLoginForm(page, user.email, user.password);
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", PROJECTS_HEADING)).toBeVisible();
}

/** Presses "Sign out" and waits for the login screen. */
export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}
