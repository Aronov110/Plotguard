import type { APIRequestContext } from "@playwright/test";
import { API_ORIGIN, WEB_ORIGIN } from "./targets.ts";
import type { TestUser } from "./users.ts";

async function post(request: APIRequestContext, path: string): Promise<void> {
  const response = await request.post(`${API_ORIGIN}${path}`);
  if (!response.ok()) {
    throw new Error(`The end-to-end API refused ${path} (status ${response.status()}).`);
  }
}

/** Holds back the reply to the next logout; the logout itself still happens at once. */
export function holdNextLogoutReply(request: APIRequestContext): Promise<void> {
  return post(request, "/__e2e/hold-next-logout-reply");
}

/** Lets a held logout reply go. Safe to call when nothing is held. */
export function releaseLogoutReply(request: APIRequestContext): Promise<void> {
  return post(request, "/__e2e/release-logout-reply");
}

/**
 * Creates an account straight through the API, so a test about logging in does not have to sign up
 * through the form first. It uses the API's own address and the web app's origin, which is what the
 * browser would send. The login cookies it receives stay in `request`, not in the browser.
 */
export async function createAccount(request: APIRequestContext, user: TestUser): Promise<void> {
  const response = await request.post(`${API_ORIGIN}/auth/register`, {
    headers: { Origin: WEB_ORIGIN },
    data: { email: user.email, password: user.password, displayName: user.displayName },
  });
  if (response.status() !== 201) {
    throw new Error(`Could not create the test account (status ${response.status()}).`);
  }
}
