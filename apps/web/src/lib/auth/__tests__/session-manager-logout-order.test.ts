import { describe, expect, it } from "vitest";
import { apiError, deferred, session, setup, USER } from "../../../test-support/session-harness.ts";
import type { PublicUser, SessionResponse } from "../../api/auth-api.ts";
import { NetworkError } from "../../api/problem.ts";
import { getAccessToken } from "../token-store.ts";

/**
 * A logout answer deletes the login cookies whenever it arrives. If it arrived after a newer
 * login's answer, it would delete the new cookies. So a login or sign-up must not be sent while a
 * sign-out request of this tab is still in flight.
 */

const CREDENTIALS = { email: "ada@example.com", password: "correct horse battery" };
const OTHER_USER: PublicUser = { id: "user-2", email: "bob@example.com", displayName: "Bob" };

/** Lets every already-resolved promise continue, so "nothing happened yet" is a real check. */
const flush = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

async function signedIn() {
  const context = setup();
  context.api.refresh.mockResolvedValueOnce(session("token-1"));
  await context.manager.start();
  return context;
}

/** A signed-in manager whose logout request stays open until the test settles it. */
async function signedOutWithLogoutInFlight() {
  const context = await signedIn();
  const logout = deferred<undefined>();
  context.api.logout.mockReturnValueOnce(logout.promise);
  const signingOut = context.manager.signOut();
  return { ...context, logout, signingOut };
}

describe("session manager: a login after a sign-out that is still in flight", () => {
  it("waits for the sign-out answer before sending the login", async () => {
    const { manager, api, logout, signingOut } = await signedOutWithLogoutInFlight();
    api.login.mockResolvedValue(session("token-2"));

    const loggingIn = manager.login(CREDENTIALS);
    await flush();
    expect(api.login).not.toHaveBeenCalled();

    logout.resolve(undefined);
    await signingOut;
    await loggingIn;

    expect(api.login).toHaveBeenCalledTimes(1);
    expect(api.login).toHaveBeenCalledWith(CREDENTIALS);
  });

  it("sends the login only after the sign-out has finished, not merely started", async () => {
    const { manager, api, logout } = await signedOutWithLogoutInFlight();
    const order: string[] = [];
    api.login.mockImplementation(() => {
      order.push("login sent");
      return Promise.resolve(session("token-2"));
    });

    const loggingIn = manager.login(CREDENTIALS);
    await flush();
    order.push("logout answered");
    logout.resolve(undefined);
    await loggingIn;

    expect(order).toEqual(["logout answered", "login sent"]);
  });

  it("does the same for a sign-up", async () => {
    const { manager, api, logout } = await signedOutWithLogoutInFlight();
    api.register.mockResolvedValue(session("token-2"));

    const registering = manager.register({ ...CREDENTIALS, displayName: "Ada" });
    await flush();
    expect(api.register).not.toHaveBeenCalled();

    logout.resolve(undefined);
    await registering;

    expect(api.register).toHaveBeenCalledTimes(1);
    expect(manager.getState()).toEqual({ status: "signed-in", user: USER });
  });

  it("ends up signed in with the new token and exactly one refresh timer", async () => {
    const { manager, api, logout, liveTimers } = await signedOutWithLogoutInFlight();
    api.login.mockResolvedValue(session("token-2"));

    const loggingIn = manager.login(CREDENTIALS);
    logout.resolve(undefined);
    await loggingIn;

    expect(manager.getState()).toEqual({ status: "signed-in", user: USER });
    expect(getAccessToken()).toBe("token-2");
    expect(liveTimers()).toHaveLength(1);
  });

  it("can end up as a different person", async () => {
    const { manager, api, logout } = await signedOutWithLogoutInFlight();
    api.login.mockResolvedValue(session("token-bob", 900, OTHER_USER));

    const loggingIn = manager.login({ email: OTHER_USER.email, password: CREDENTIALS.password });
    logout.resolve(undefined);
    await loggingIn;

    expect(manager.getState()).toEqual({ status: "signed-in", user: OTHER_USER });
  });

  it("stays signed out, with no token and no timer, while it waits", async () => {
    const { manager, api, logout, liveTimers } = await signedOutWithLogoutInFlight();
    api.login.mockResolvedValue(session("token-2"));

    const loggingIn = manager.login(CREDENTIALS);
    await flush();

    expect(manager.getState()).toEqual({ status: "signed-out" });
    expect(getAccessToken()).toBeUndefined();
    expect(liveTimers()).toHaveLength(0);

    logout.resolve(undefined);
    await loggingIn;
  });

  it("tells the subscribers about the sign-in only after the wait", async () => {
    const { manager, api, logout } = await signedOutWithLogoutInFlight();
    api.login.mockResolvedValue(session("token-2"));
    let calls = 0;
    manager.subscribe(() => {
      calls++;
    });

    const loggingIn = manager.login(CREDENTIALS);
    await flush();
    expect(calls).toBe(0);

    logout.resolve(undefined);
    await loggingIn;
    expect(calls).toBe(1);
  });

  describe("when the sign-out ends badly", () => {
    it("still sends the login after the sign-out failed to reach the server", async () => {
      const { manager, api, logout, signingOut } = await signedOutWithLogoutInFlight();
      api.login.mockResolvedValue(session("token-2"));

      const loggingIn = manager.login(CREDENTIALS);
      logout.reject(new NetworkError());

      expect(await signingOut).toBe(false);
      await loggingIn;
      expect(api.login).toHaveBeenCalledTimes(1);
      expect(manager.getState()).toEqual({ status: "signed-in", user: USER });
    });

    it("still sends the login after the server refused the sign-out", async () => {
      const { manager, api, logout, signingOut } = await signedOutWithLogoutInFlight();
      api.login.mockResolvedValue(session("token-2"));

      const loggingIn = manager.login(CREDENTIALS);
      logout.reject(apiError(403));

      expect(await signingOut).toBe(false);
      await loggingIn;
      expect(api.login).toHaveBeenCalledTimes(1);
    });

    it("still sends the login after the sign-out broke in an unexpected way, which still rejects there", async () => {
      const { manager, api, logout, signingOut } = await signedOutWithLogoutInFlight();
      api.login.mockResolvedValue(session("token-2"));
      const bug = new Error("a bug in the logout call");

      const loggingIn = manager.login(CREDENTIALS);
      logout.reject(bug);

      await expect(signingOut).rejects.toBe(bug);
      await loggingIn;
      expect(api.login).toHaveBeenCalledTimes(1);
      expect(manager.getState()).toEqual({ status: "signed-in", user: USER });
    });

    it("does not hide the login's own failure after the wait, and changes nothing", async () => {
      const { manager, api, logout } = await signedOutWithLogoutInFlight();
      api.login.mockRejectedValue(apiError(401));

      const loggingIn = manager.login(CREDENTIALS);
      logout.resolve(undefined);

      await expect(loggingIn).rejects.toMatchObject({ status: 401 });
      expect(manager.getState()).toEqual({ status: "signed-out" });
      expect(getAccessToken()).toBeUndefined();
    });

    it("does not hide a sign-up's own failure after the wait", async () => {
      const { manager, api, logout } = await signedOutWithLogoutInFlight();
      api.register.mockRejectedValue(apiError(409));

      const registering = manager.register(CREDENTIALS);
      logout.resolve(undefined);

      await expect(registering).rejects.toMatchObject({ status: 409 });
      expect(manager.getState()).toEqual({ status: "signed-out" });
    });

    it("lets the next login through once a failed login ended the wait", async () => {
      const { manager, api, logout } = await signedOutWithLogoutInFlight();
      api.login.mockRejectedValueOnce(apiError(401)).mockResolvedValueOnce(session("token-2"));

      const first = manager.login(CREDENTIALS);
      logout.resolve(undefined);
      await expect(first).rejects.toMatchObject({ status: 401 });

      await manager.login(CREDENTIALS);
      expect(api.login).toHaveBeenCalledTimes(2);
      expect(manager.getState()).toEqual({ status: "signed-in", user: USER });
    });
  });

  describe("with several sign-outs", () => {
    it("waits for all of them", async () => {
      const { manager, api, logout, signingOut } = await signedOutWithLogoutInFlight();
      const second = deferred<undefined>();
      api.logout.mockReturnValueOnce(second.promise);
      const signingOutAgain = manager.signOut();
      api.login.mockResolvedValue(session("token-2"));

      const loggingIn = manager.login(CREDENTIALS);
      logout.resolve(undefined);
      await signingOut;
      await flush();
      expect(api.login).not.toHaveBeenCalled();

      second.resolve(undefined);
      await signingOutAgain;
      await loggingIn;
      expect(api.login).toHaveBeenCalledTimes(1);
    });

    it("also waits for a sign-out that starts while the login is already waiting", async () => {
      const { manager, api, logout, signingOut } = await signedOutWithLogoutInFlight();
      api.login.mockResolvedValue(session("token-2"));
      const loggingIn = manager.login(CREDENTIALS);
      await flush();

      const second = deferred<undefined>();
      api.logout.mockReturnValueOnce(second.promise);
      const signingOutAgain = manager.signOut();
      logout.resolve(undefined);
      await signingOut;
      await flush();
      expect(api.login).not.toHaveBeenCalled();

      second.resolve(undefined);
      await signingOutAgain;
      await loggingIn;
      expect(api.login).toHaveBeenCalledTimes(1);
    });

    it("sends a login and a sign-up that were both waiting, once the sign-out is over", async () => {
      const { manager, api, logout } = await signedOutWithLogoutInFlight();
      api.login.mockResolvedValue(session("token-2"));
      api.register.mockResolvedValue(session("token-3"));

      const loggingIn = manager.login(CREDENTIALS);
      const registering = manager.register(CREDENTIALS);
      await flush();
      expect(api.login).not.toHaveBeenCalled();
      expect(api.register).not.toHaveBeenCalled();

      logout.resolve(undefined);
      await Promise.all([loggingIn, registering]);
      expect(api.login).toHaveBeenCalledTimes(1);
      expect(api.register).toHaveBeenCalledTimes(1);
    });
  });
});

describe("session manager: a login that has nothing to wait for", () => {
  it("sends the login straight away when nobody signed out", async () => {
    const { manager, api } = setup({ csrf: undefined });
    api.login.mockResolvedValue(session("token-2"));

    const loggingIn = manager.login(CREDENTIALS);
    // Called in the same turn: no extra waiting was added to the normal path.
    expect(api.login).toHaveBeenCalledTimes(1);
    await loggingIn;
  });

  it("sends the sign-up straight away when nobody signed out", async () => {
    const { manager, api } = setup({ csrf: undefined });
    api.register.mockResolvedValue(session("token-2"));

    const registering = manager.register(CREDENTIALS);
    expect(api.register).toHaveBeenCalledTimes(1);
    await registering;
  });

  it("is not delayed by a sign-out that finished long ago", async () => {
    const { manager, api } = await signedIn();
    await manager.signOut();
    api.login.mockResolvedValue(session("token-2"));

    const loggingIn = manager.login(CREDENTIALS);
    expect(api.login).toHaveBeenCalledTimes(1);
    await loggingIn;
  });

  it("is not delayed by a sign-out that failed long ago", async () => {
    const { manager, api } = await signedIn();
    api.logout.mockRejectedValueOnce(new NetworkError());
    expect(await manager.signOut()).toBe(false);
    api.login.mockResolvedValue(session("token-2"));

    const loggingIn = manager.login(CREDENTIALS);
    expect(api.login).toHaveBeenCalledTimes(1);
    await loggingIn;
  });

  it("is not delayed by a sign-out that another tab announced", async () => {
    const { manager, api, broadcast } = await signedIn();
    broadcast.emit();
    expect(manager.getState()).toEqual({ status: "signed-out" });
    api.login.mockResolvedValue(session("token-2"));

    const loggingIn = manager.login(CREDENTIALS);
    expect(api.login).toHaveBeenCalledTimes(1);
    await loggingIn;
    expect(api.logout).not.toHaveBeenCalled();
  });

  it("can sign out, sign in and sign out again without the earlier sign-outs getting in the way", async () => {
    const { manager, api } = await signedIn();
    api.login.mockResolvedValue(session("token-2"));

    await manager.signOut();
    await manager.login(CREDENTIALS);
    expect(await manager.signOut()).toBe(true);
    await manager.login(CREDENTIALS);

    expect(api.logout).toHaveBeenCalledTimes(2);
    expect(api.login).toHaveBeenCalledTimes(2);
    expect(manager.getState()).toEqual({ status: "signed-in", user: USER });
  });
});

describe("session manager: the sign-out itself is not slowed down", () => {
  it("signs out on the page and sends the logout request in the same turn", async () => {
    const { manager, api } = await signedIn();
    const signingOut = manager.signOut();

    expect(manager.getState()).toEqual({ status: "signed-out" });
    expect(api.logout).toHaveBeenCalledTimes(1);
    await signingOut;
  });

  it("does not wait for an earlier sign-out before sending its own", async () => {
    const { manager, api, signingOut } = await signedOutWithLogoutInFlight();
    api.logout.mockResolvedValueOnce(undefined);

    const again = manager.signOut();

    expect(api.logout).toHaveBeenCalledTimes(2);
    expect(await again).toBe(true);
    void signingOut;
  });
});

describe("session manager: an old refresh answer after the wait", () => {
  it("cannot revive the old login, and the new login stays", async () => {
    const { manager, api } = await signedIn();
    const logout = deferred<undefined>();
    const oldRefresh = deferred<SessionResponse>();
    api.refresh.mockReturnValue(oldRefresh.promise);
    const refreshing = manager.refresh();
    api.logout.mockReturnValueOnce(logout.promise);
    const signingOut = manager.signOut();
    api.login.mockResolvedValue(session("token-new"));

    const loggingIn = manager.login(CREDENTIALS);
    logout.resolve(undefined);
    await signingOut;
    await loggingIn;
    oldRefresh.resolve(session("token-old"));

    expect(await refreshing).toBe(false);
    expect(getAccessToken()).toBe("token-new");
    expect(manager.getState()).toEqual({ status: "signed-in", user: USER });
  });
});
