import { describe, expect, it, vi } from "vitest";
import { apiError, deferred, session, setup } from "../../../test-support/session-harness.ts";
import type { SessionResponse } from "../../api/auth-api.ts";
import { NetworkError } from "../../api/problem.ts";
import { getAccessToken } from "../token-store.ts";

async function signedIn(token = "token-1") {
  const context = setup();
  context.api.refresh.mockResolvedValueOnce(session(token));
  await context.manager.start();
  context.api.refresh.mockReset();
  return context;
}

describe("after signing out, nothing brings the login back", () => {
  it("withAuth does not refresh while the logout request is still travelling", async () => {
    const { manager, api } = await signedIn();
    const logout = deferred<undefined>();
    api.logout.mockReturnValue(logout.promise);
    api.refresh.mockResolvedValue(session("token-risen"));

    const signingOut = manager.signOut();
    const original = apiError(401);
    await expect(manager.withAuth(() => Promise.reject(original))).rejects.toBe(original);

    expect(api.refresh).not.toHaveBeenCalled();
    expect(manager.getState()).toEqual({ status: "signed-out" });
    expect(getAccessToken()).toBeUndefined();
    logout.resolve(undefined);
    await signingOut;
  });

  it("refresh() does nothing while the logout request is still travelling", async () => {
    const { manager, api, liveTimers } = await signedIn();
    api.logout.mockReturnValue(deferred<undefined>().promise);
    void manager.signOut();

    expect(await manager.refresh()).toBe(false);

    expect(api.refresh).not.toHaveBeenCalled();
    expect(manager.getState()).toEqual({ status: "signed-out" });
    expect(getAccessToken()).toBeUndefined();
    expect(liveTimers()).toHaveLength(0);
  });

  it("refresh() does nothing after the logout finished", async () => {
    const { manager, api } = await signedIn();
    await manager.signOut();
    expect(await manager.refresh()).toBe(false);
    expect(api.refresh).not.toHaveBeenCalled();
  });

  it("a new login after signing out can refresh again", async () => {
    const { manager, api } = await signedIn();
    await manager.signOut();
    api.login.mockResolvedValue(session("token-new"));
    await manager.login({ email: "a@b.test", password: "x" });
    api.refresh.mockResolvedValue(session("token-renewed"));

    expect(await manager.refresh()).toBe(true);
    expect(getAccessToken()).toBe("token-renewed");
  });

  it("signing out while the first restore is still running discards its answer", async () => {
    const { manager, api } = setup();
    const pending = deferred<SessionResponse>();
    api.refresh.mockReturnValue(pending.promise);
    const started = manager.start();

    await manager.signOut();
    pending.resolve(session("token-late"));
    await started;

    expect(manager.getState()).toEqual({ status: "signed-out" });
    expect(getAccessToken()).toBeUndefined();
  });
});

describe("a refresh from before a new login is not shared with callers after it", () => {
  it("withAuth after a login makes its own refresh instead of joining the stale one", async () => {
    const { manager, api } = await signedIn();
    const stale = deferred<SessionResponse>();
    api.refresh.mockReturnValueOnce(stale.promise);
    const old = manager.refresh();

    api.login.mockResolvedValue(session("token-login"));
    await manager.login({ email: "a@b.test", password: "x" });
    api.refresh.mockResolvedValueOnce(session("token-fresh"));
    let attempts = 0;
    const result = manager.withAuth(() => {
      attempts++;
      return attempts === 1 ? Promise.reject(apiError(401)) : Promise.resolve("done");
    });

    await expect(result).resolves.toBe("done");
    expect(api.refresh).toHaveBeenCalledTimes(2);
    expect(getAccessToken()).toBe("token-fresh");

    stale.resolve(session("token-old"));
    expect(await old).toBe(false);
    expect(getAccessToken()).toBe("token-fresh");
  });

  it("callers from the same login still share one refresh", async () => {
    const { manager, api } = await signedIn();
    const pending = deferred<SessionResponse>();
    api.refresh.mockReturnValue(pending.promise);

    const results = Promise.all([manager.refresh(), manager.refresh(), manager.refresh()]);
    pending.resolve(session("token-2"));

    expect(await results).toEqual([true, true, true]);
    expect(api.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("a refresh that fails for a passing reason is tried again", () => {
  async function runningTimer() {
    const context = await signedIn();
    return { ...context, first: context.timers[0] };
  }

  const delays = (timers: { ms: number }[]) => timers.map((timer) => timer.ms);

  it("retries after 5 seconds, then doubles the wait up to a minute", async () => {
    const { api, timers } = await runningTimer();
    api.refresh.mockRejectedValue(new NetworkError());

    for (let round = 1; round <= 7; round++) {
      timers.at(-1)?.callback();
      await vi.waitFor(() => expect(timers).toHaveLength(round + 1));
    }

    expect(delays(timers)).toEqual([840_000, 5000, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000]);
  });

  it("goes back to the normal schedule after a success, and starts the waits over later", async () => {
    const { api, timers } = await runningTimer();
    api.refresh.mockRejectedValueOnce(new NetworkError());
    timers.at(-1)?.callback();
    await vi.waitFor(() => expect(timers).toHaveLength(2));
    expect(timers[1]?.ms).toBe(5000);

    api.refresh.mockResolvedValueOnce(session("token-2", 900));
    timers.at(-1)?.callback();
    await vi.waitFor(() => expect(timers).toHaveLength(3));
    expect(timers[2]?.ms).toBe(840_000);
    expect(getAccessToken()).toBe("token-2");

    api.refresh.mockRejectedValueOnce(new NetworkError());
    timers.at(-1)?.callback();
    await vi.waitFor(() => expect(timers).toHaveLength(4));
    expect(timers[3]?.ms).toBe(5000);
  });

  it.each([
    ["the server is down (503)", apiError(503)],
    ["the server is slow to answer (500)", apiError(500)],
    ["too many requests (429)", apiError(429)],
  ])("also retries when %s", async (_name, failure) => {
    const { api, timers } = await runningTimer();
    api.refresh.mockRejectedValue(failure);
    timers.at(-1)?.callback();
    await vi.waitFor(() => expect(timers).toHaveLength(2));
    expect(timers[1]?.ms).toBe(5000);
  });

  it("stays signed in while it retries", async () => {
    const { manager, api, timers } = await runningTimer();
    api.refresh.mockRejectedValue(new NetworkError());
    timers.at(-1)?.callback();
    await vi.waitFor(() => expect(timers).toHaveLength(2));
    expect(manager.getState().status).toBe("signed-in");
    expect(getAccessToken()).toBe("token-1");
  });

  it("does not retry when the server refuses the login for good, and signs out", async () => {
    const { manager, api, timers } = await runningTimer();
    api.refresh.mockRejectedValue(apiError(401));
    timers.at(-1)?.callback();
    await vi.waitFor(() => expect(manager.getState()).toEqual({ status: "signed-out" }));
    expect(timers).toHaveLength(1);
  });

  it("does not retry after an unexpected failure, which is reported instead", async () => {
    const { api, timers, reportError } = await runningTimer();
    const surprise = new TypeError("broken");
    api.refresh.mockRejectedValue(surprise);
    timers.at(-1)?.callback();
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledExactlyOnceWith(surprise));
    expect(timers).toHaveLength(1);
  });

  it("stop() cancels a waiting retry", async () => {
    const { manager, api, timers, liveTimers } = await runningTimer();
    api.refresh.mockRejectedValue(new NetworkError());
    timers.at(-1)?.callback();
    await vi.waitFor(() => expect(timers).toHaveLength(2));
    expect(liveTimers()).toHaveLength(1);

    manager.stop();

    expect(liveTimers()).toHaveLength(0);
  });

  it("signing out cancels a waiting retry", async () => {
    const { manager, api, timers, liveTimers } = await runningTimer();
    api.refresh.mockRejectedValue(new NetworkError());
    timers.at(-1)?.callback();
    await vi.waitFor(() => expect(timers).toHaveLength(2));

    await manager.signOut();

    expect(liveTimers()).toHaveLength(0);
  });

  it("does not schedule a retry when stop() came while the refresh was running", async () => {
    const { manager, api, timers } = await runningTimer();
    const pending = deferred<SessionResponse>();
    api.refresh.mockReturnValue(pending.promise);
    timers.at(-1)?.callback();
    manager.stop();
    pending.reject(new NetworkError());
    await vi.waitFor(() => expect(api.refresh).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(timers).toHaveLength(1);
  });
});

describe("signing out in one tab signs out the others", () => {
  it("announces the sign-out to the other tabs", async () => {
    const { manager, broadcast } = await signedIn();
    await manager.signOut();
    expect(broadcast.announceSignOut).toHaveBeenCalledTimes(1);
  });

  it("announces it even when the server cannot be reached", async () => {
    const { manager, api, broadcast } = await signedIn();
    api.logout.mockRejectedValue(new NetworkError());
    expect(await manager.signOut()).toBe(false);
    expect(broadcast.announceSignOut).toHaveBeenCalledTimes(1);
  });

  it("announces it before the server has answered, so other tabs react at once", async () => {
    const { manager, api, broadcast } = await signedIn();
    api.logout.mockReturnValue(deferred<undefined>().promise);
    void manager.signOut();
    expect(broadcast.announceSignOut).toHaveBeenCalledTimes(1);
  });

  it("still signs out, and reports the problem, when announcing fails", async () => {
    const { manager, broadcast, reportError } = await signedIn();
    const failure = new Error("channel closed");
    broadcast.announceSignOut.mockImplementation(() => {
      throw failure;
    });

    expect(await manager.signOut()).toBe(true);

    expect(reportError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(manager.getState()).toEqual({ status: "signed-out" });
  });

  it("signs out when another tab announces it, without calling the server or echoing", async () => {
    const { manager, api, broadcast, liveTimers } = await signedIn();

    broadcast.emit();

    expect(manager.getState()).toEqual({ status: "signed-out" });
    expect(getAccessToken()).toBeUndefined();
    expect(liveTimers()).toHaveLength(0);
    expect(api.logout).not.toHaveBeenCalled();
    expect(broadcast.announceSignOut).not.toHaveBeenCalled();
  });

  it("tells listeners once", async () => {
    const { manager, broadcast } = await signedIn();
    const listener = vi.fn();
    manager.subscribe(listener);
    broadcast.emit();
    broadcast.emit();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does nothing when this tab is already signed out", async () => {
    const { manager, broadcast } = setup({ csrf: undefined });
    await manager.start();
    const listener = vi.fn();
    manager.subscribe(listener);
    broadcast.emit();
    expect(listener).not.toHaveBeenCalled();
  });

  it("signs out a tab that is still restoring, and discards the restore's answer", async () => {
    const { manager, api, broadcast } = setup();
    const pending = deferred<SessionResponse>();
    api.refresh.mockReturnValue(pending.promise);
    const started = manager.start();

    broadcast.emit();
    pending.resolve(session("token-late"));
    await started;

    expect(manager.getState()).toEqual({ status: "signed-out" });
    expect(getAccessToken()).toBeUndefined();
  });

  it("does not refresh afterwards, even when a call gets a 401", async () => {
    const { manager, api, broadcast } = await signedIn();
    broadcast.emit();
    api.refresh.mockResolvedValue(session("token-risen"));
    const original = apiError(401);
    await expect(manager.withAuth(() => Promise.reject(original))).rejects.toBe(original);
    expect(api.refresh).not.toHaveBeenCalled();
  });

  it("can sign in again afterwards", async () => {
    const { manager, api, broadcast } = await signedIn();
    broadcast.emit();
    api.login.mockResolvedValue(session("token-again"));
    await manager.login({ email: "a@b.test", password: "x" });
    expect(manager.getState().status).toBe("signed-in");
    expect(getAccessToken()).toBe("token-again");
  });

  describe("listening", () => {
    it("starts only when the manager starts", () => {
      const { broadcast } = setup();
      expect(broadcast.onSignOut).not.toHaveBeenCalled();
    });

    it("listens once, however often start() is called", async () => {
      const { manager, api, broadcast } = setup();
      api.refresh.mockResolvedValue(session());
      await manager.start();
      await manager.start();
      expect(broadcast.onSignOut).toHaveBeenCalledTimes(1);
      expect(broadcast.listenerCount()).toBe(1);
    });

    it("stops when the manager stops", async () => {
      const { manager, api, broadcast } = setup();
      api.refresh.mockResolvedValue(session());
      await manager.start();
      manager.stop();
      expect(broadcast.listenerCount()).toBe(0);
    });

    it("ignores announcements while stopped", async () => {
      const { manager, api, broadcast } = setup();
      api.refresh.mockResolvedValue(session());
      await manager.start();
      manager.stop();
      broadcast.emit();
      expect(manager.getState().status).toBe("signed-in");
    });

    it("listens again after stop() and start()", async () => {
      const { manager, api, broadcast } = setup();
      api.refresh.mockResolvedValue(session());
      await manager.start();
      manager.stop();
      await manager.start();
      expect(broadcast.listenerCount()).toBe(1);
      broadcast.emit();
      expect(manager.getState()).toEqual({ status: "signed-out" });
    });

    it("listens from the start of the restore, not only after it", () => {
      const { manager, api, broadcast } = setup();
      api.refresh.mockReturnValue(deferred<SessionResponse>().promise);
      void manager.start();
      expect(broadcast.listenerCount()).toBe(1);
    });
  });
});
