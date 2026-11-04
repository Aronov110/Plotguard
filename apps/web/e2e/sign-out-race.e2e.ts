import { expect, test } from "@playwright/test";
import { holdNextLogoutReply, releaseLogoutReply } from "./support/api-control.ts";
import { logIn, PROJECTS_HEADING, signOut, signUp } from "./support/flows.ts";
import { WEB_ORIGIN } from "./support/targets.ts";
import { uniqueUser } from "./support/users.ts";

// Review finding 2 (see .plans/2026-11-02-auth-frontend.md): a sign-out whose answer arrives late,
// followed at once by a new login, might let the old answer undo the new login.
//
// The answer to a logout carries `Set-Cookie` headers that delete the login cookies. The browser
// applies them whenever the answer arrives, whatever the page's code thinks by then. The end-to-end
// API can hold that answer back (the logout itself still happens at once), which is what a slow
// network does. Timing is controlled by that switch and by waiting for events, never by sleeping.

const cookieNamed =
  (name: string) =>
  (cookie: { readonly name: string }): boolean =>
    cookie.name === name;

test("a late sign-out answer does not delete the cookies of the login that came after it", async ({
  page,
  context,
  request,
}) => {
  // KNOWN BUG, reproduced on 2026-11-04 (finding 2 is real): the late answer's Set-Cookie headers
  // delete the NEW login's cookies, so the next reload shows the person signed out although they
  // just logged in. Decision of the plan: record it here, fix it in its own PR. When the fix lands,
  // this test starts to pass, Playwright reports "expected to fail, but passed", and the next line
  // is deleted.
  test.fail(true, "Finding 2: a late logout answer clears the cookies of a newer login.");

  const user = uniqueUser();
  await signUp(page, user);

  await holdNextLogoutReply(request);
  try {
    // 1. Sign out. The server ends the login at once, but its answer is held back.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    // Proof that the hold works: the answer has not arrived, so the cookies are still there.
    expect((await context.cookies()).some(cookieNamed("csrf_token"))).toBe(true);

    // 2. Log in again while the old answer is still on its way.
    await logIn(page, user);

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

  // 4. The new login's cookies must have survived the late answer...
  const names = (await context.cookies()).map((cookie) => cookie.name);
  expect(names).toContain("refresh_token");
  expect(names).toContain("csrf_token");

  // 5. ...so that after a reload the person is still signed in.
  await page.reload();
  await expect(page.getByRole("heading", PROJECTS_HEADING)).toBeVisible();
  await expect(page).toHaveURL(/\/app$/);
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
