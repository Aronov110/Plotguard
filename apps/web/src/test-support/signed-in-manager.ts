import type { PublicUser } from "../lib/api/auth-api.ts";
import { session, setup, USER } from "./session-harness.ts";

/**
 * A session manager that is already signed in as `user`, wired to fakes like `setup()`. Tests pass
 * `manager` to the `AuthProvider`; `api.logout` and the others can still be scripted.
 */
export async function signedInManager(user: PublicUser = USER) {
  const context = setup();
  context.api.refresh.mockResolvedValue(session("token-1", 900, user));
  await context.manager.start();
  context.api.refresh.mockClear();
  return context;
}
