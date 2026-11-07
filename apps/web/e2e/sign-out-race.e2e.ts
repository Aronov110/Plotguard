import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { createAccount, holdNextLogoutReply, releaseLogoutReply } from "./support/api-control.ts";
import { PROJECTS_HEADING, signOut, signUp, submitLoginForm } from "./support/flows.ts";
import { WEB_ORIGIN } from "./support/targets.ts";
import { uniqueUser } from "./support/users.ts";

// Review finding 2 (see .plans/2026-11-02-auth-frontend.md), fixed in .plans/2026-11-05-sign-out-
// login-race.md: a sign-out whose answer arrives late, followed at once by a new login, used to let
// the old answer undo the new login.
//
// The answer to a logout carries `Set-Cookie` headers that delete the login cookies. The browser
// applies them whenever the answer arrives, whatever the page's code thinks by then. So the page now
// sends a login only after the sign-out answer has arrived (or the request has failed). The
// end-to-end API can hold that answer back (the logout itself still happens at once), which is what
// a slow network does. Timing is controlled by that switch and by waiting for events, never by
// sleeping.

const cookieNamed =
  (name: string) =>
  (cookie: { readonly name: string }): boolean =>
    cookie.name === name;

/**
 * Notes, in the order they happen in the browser, when the logout answer arrives and when a login
 * request leaves. Comparing that order is how the tests prove "the login waited".
 */
function recordOrder(page: Page): readonly string[] {
  const events: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/auth/login") && request.method() === "POST") {
      events.push("login sent");
    }
  });
  page.on("response", (response) => {
    if (response.url().endsWith("/auth/logout") && response.request().method() === "POST") {
      events.push("logout answered");
    }
  });
  return events;
}

/**
 * Signs `first` out with the answer held, submits the login form for `second` meanwhile, checks
 * that the login is waiting, lets the answer go, and waits until the browser has applied it.
 * Returns the recorded order of events.
 */
async function logInWhileSignOutIsHeld(
  page: Page,
  request: APIRequestContext,
  second: { readonly email: string; readonly password: string },
): Promise<readonly string[]> {
  const events = recordOrder(page);
  await holdNextLogoutReply(request);
  try {
    // 1. Sign out. The server ends the login at once, but its answer is held back.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    // 2. Press "Log in" while the old answer is still on its way. The form shows it is working.
    await submitLoginForm(page, second.email, second.password);
    await expect(page.getByRole("button", { name: "Log in" })).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("status")).toHaveText("Signing you in…");
    expect(events).toEqual([]);

    // 3. Let the old answer arrive, and wait until the browser has it.
    const lateAnswer = page.waitForResponse(
      (response) =>
        response.url().endsWith("/auth/logout") && response.request().method() === "POST",
    );
    await releaseLogoutReply(request);
    await lateAnswer;
  } finally {
    // Never leave the server holding a reply if the test failed half-way.
    await releaseLogoutReply(request);
  }
  return events;
}

test("a late sign-out answer does not delete the cookies of the login that came after it", async ({
  page,
  context,
  request,
}) => {
  const user = uniqueUser();
  await signUp(page, user);

  const events = await logInWhileSignOutIsHeld(page, request, user);

  // The login has been sent only after the old answer had arrived...
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", PROJECTS_HEADING)).toBeVisible();
  expect(events).toEqual(["logout answered", "login sent"]);

  // ...so the new login's cookies are there...
  const names = (await context.cookies()).map((cookie) => cookie.name);
  expect(names).toContain("refresh_token");
  expect(names).toContain("csrf_token");

  // ...and after a reload the person is still signed in.
  await page.reload();
  await expect(page.getByRole("heading", PROJECTS_HEADING)).toBeVisible();
  await expect(page).toHaveURL(/\/app$/);
});

test("signing in as someone else while a sign-out answer is held ends as that other person", async ({
  page,
  request,
}) => {
  const first = uniqueUser();
  const second = uniqueUser();
  await createAccount(request, second);
  await signUp(page, first);

  const events = await logInWhileSignOutIsHeld(page, request, second);

  await expect(page).toHaveURL(/\/app$/);
  expect(events).toEqual(["logout answered", "login sent"]);
  await expect(page.getByText(second.displayName, { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", PROJECTS_HEADING)).toBeVisible();
  await expect(page.getByText(second.displayName, { exact: true })).toBeVisible();
  await expect(page.getByText(first.displayName, { exact: true })).toHaveCount(0);
});

test("a sign-out whose answer is held has already ended the login on the server", async ({
  page,
  context,
  request,
}) => {
  const user = uniqueUser();
  await signUp(page, user);

  await holdNextLogoutReply(request);
  try {
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    // The answer has not arrived, so the browser still has both cookies...
    const cookies = await context.cookies();
    const csrf = cookies.find(cookieNamed("csrf_token"));
    expect(csrf).toBeDefined();
    expect(cookies.some(cookieNamed("refresh_token"))).toBe(true);

    // ...but the server already ended the login: trying to renew it with those very cookies is
    // refused. (The page is not navigated meanwhile: leaving it would cancel the held request.)
    const refresh = await page.request.post(`${WEB_ORIGIN}/auth/refresh`, {
      headers: { Origin: WEB_ORIGIN, "X-CSRF-Token": csrf?.value ?? "" },
    });
    expect(refresh.status()).toBe(401);
  } finally {
    await releaseLogoutReply(request);
  }

  // Once the answer is delivered, the cookies are deleted, as after any sign-out.
  await expect
    .poll(async () => (await context.cookies()).some(cookieNamed("csrf_token")))
    .toBe(false);
  await expect
    .poll(async () => (await context.cookies()).some(cookieNamed("refresh_token")))
    .toBe(false);
});

test("a hold that is released with nothing waiting does no harm", async ({ page, request }) => {
  await releaseLogoutReply(request);
  await signUp(page, uniqueUser());
  await signOut(page);
  await expect(page.getByRole("heading", { level: 1, name: "Log in" })).toBeVisible();
});
