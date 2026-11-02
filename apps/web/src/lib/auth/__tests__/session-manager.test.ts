import { describe, expect, it, vi } from "vitest";
import type { AuthApi, PublicUser, SessionResponse } from "../../api/auth-api.ts";
import { ApiError, NetworkError, ResponseShapeError } from "../../api/problem.ts";
import { createSessionManager } from "../session-manager.ts";
import { getAccessToken } from "../token-store.ts";

const USER: PublicUser = { id: "user-1", email: "ada@example.com", displayName: null };

function session(
  accessToken = "token-1",
  expiresIn = 900,
  user: PublicUser = USER,
): SessionResponse {
  return { user, accessToken, expiresIn };
}

function apiError(status: number): ApiError {
  return new ApiError({
    status,
    code: undefined,
    detail: undefined,
    issues: [],
    retryAfterSeconds: undefined,
  });
}

interface FakeTimer {
  readonly callback: () => void;
  readonly ms: number;
  cancelled: boolean;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// A default parameter would turn an explicit `undefined` back into the default value, so "no CSRF
// cookie" is passed as `{ csrf: undefined }` and detected with `in`.
function setup(options: { csrf?: string | undefined } = {}) {
  const api = {
    register: vi.fn<AuthApi["register"]>(),
    login: vi.fn<AuthApi["login"]>(),
    refresh: vi.fn<AuthApi["refresh"]>(),
    logout: vi.fn<AuthApi["logout"]>().mockResolvedValue(undefined),
    me: vi.fn<AuthApi["me"]>(),
  };
  const timers: FakeTimer[] = [];
  let clock = 1_000_000;
  let csrf = "csrf" in options ? options.csrf : "csrf-code";
  const wait = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
  const reportError = vi.fn<(error: unknown) => void>();

  const manager = createSessionManager({
    api,
    readCsrf: () => csrf,
    now: () => clock,
    wait,
    reportError,
    setTimer: (callback, ms) => {
      const timer: FakeTimer = { callback, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });

  return {
    api,
    manager,
    timers,
    wait,
    reportError,
    liveTimers: () => timers.filter((timer) => !timer.cancelled),
    setCsrf: (value: string | undefined) => {
      csrf = value;
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("session manager: starting", () => {
  it("is loading before it starts", () => {
    const { manager } = setup();
    expect(manager.getState()).toEqual({ status: "loading" });
  });

  it("becomes signed out without any request when there is no CSRF cookie", async () => {
    const { manager, api } = setup({ csrf: undefined });
    await manager.start();
    expect(manager.getState()).toEqual({ status: "signed-out" });
    expect(api.refresh).not.toHaveBeenCalled();
    expect(getAccessToken()).toBeUndefined();
  });

  it("restores the session with a refresh when the CSRF cookie exists", async () => {
    const { manager, api } = setup();
    api.refresh.mockResolvedValue(session("token-1"));
    await manager.start();
    expect(manager.getState()).toEqual({ status: "signed-in", user: USER });
    expect(getAccessToken()).toBe("token-1");
    expect(api.refresh).toHaveBeenCalledTimes(1);
  });

  it("notifies listeners once when the restore finishes", async () => {
    const { manager, api } = setup();
    api.refresh.mockResolvedValue(session());
    const listener = vi.fn();
    manager.subscribe(listener);
    await manager.start();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("restores only once when started twice at the same time", async () => {
    const { manager, api } = setup();
    api.refresh.mockResolvedValue(session());
    await Promise.all([manager.start(), manager.start()]);
    expect(api.refresh).toHaveBeenCalledTimes(1);
  });

  it("does nothing when started again after it has finished", async () => {
    const { manager, api } = setup();
    api.refresh.mockResolvedValue(session());
    await manager.start();
    await manager.start();
    expect(api.refresh).toHaveBeenCalledTimes(1);
  });

  it("becomes signed out when the refresh is refused twice", async () => {
    const { manager, api, wait } = setup();
    api.refresh.mockRejectedValue(apiError(401));
    await manager.start();
    expect(manager.getState()).toEqual({ status: "signed-out" });
    expect(api.refresh).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledExactlyOnceWith(300);
    expect(getAccessToken()).toBeUndefined();
  });

  it("survives losing the refresh race: a 401, a short wait, then success", async () => {
    const { manager, api, wait } = setup();
    api.refresh.mockRejectedValueOnce(apiError(401)).mockResolvedValueOnce(session("token-won"));
    await manager.start();
    expect(wait).toHaveBeenCalledExactlyOnceWith(300);
    expect(api.refresh).toHaveBeenCalledTimes(2);
    expect(manager.getState()).toEqual({ status: "signed-in", user: USER });
    expect(getAccessToken()).toBe("token-won");
  });

  it("does not retry a 403, which means the CSRF code is wrong", async () => {
    const { manager, api, wait } = setup();
    api.refresh.mockRejectedValue(apiError(403));
    await manager.start();
    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
    expect(manager.getState()).toEqual({ status: "signed-out" });
  });

  it("becomes signed out, without retrying, when the network fails during the restore", async () => {
    const { manager, api } = setup();
    api.refresh.mockRejectedValue(new NetworkError());
    await manager.start();
    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(manager.getState()).toEqual({ status: "signed-out" });
  });

  it("becomes signed out when the server fails during the restore", async () => {
    const { manager, api } = setup();
    api.refresh.mockRejectedValue(apiError(503));
    await manager.start();
    expect(manager.getState()).toEqual({ status: "signed-out" });
  });

  it("does not report the failures it expects: refused sessions, network, server errors", async () => {
    const { manager, api, reportError } = setup();
    api.refresh.mockRejectedValue(apiError(401));
    await manager.start();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("reports an unexpected failure, such as an answer with the wrong shape, and signs out", async () => {
    const { manager, api, reportError } = setup();
    const surprise = new ResponseShapeError("The API's answer did not have the expected shape.");
    api.refresh.mockRejectedValue(surprise);
    await manager.start();
    expect(reportError).toHaveBeenCalledExactlyOnceWith(surprise);
    expect(manager.getState()).toEqual({ status: "signed-out" });
  });
});

describe("session manager: signing in", () => {
  it("login stores the token, signs in and schedules a refresh", async () => {
    const { manager, api, timers } = setup({ csrf: undefined });
    await manager.start();
    api.login.mockResolvedValue(session("token-2"));
    await manager.login({ email: "ada@example.com", password: "correct horse battery" });
    expect(api.login).toHaveBeenCalledWith({
      email: "ada@example.com",
      password: "correct horse battery",
    });
    expect(manager.getState()).toEqual({ status: "signed-in", user: USER });
    expect(getAccessToken()).toBe("token-2");
    expect(timers).toHaveLength(1);
  });

  it("register passes the details on and signs in", async () => {
    const { manager, api } = setup({ csrf: undefined });
    await manager.start();
    api.register.mockResolvedValue(session("token-3"));
    await manager.register({
      email: "ada@example.com",
      password: "correct horse battery",
      displayName: "Ada",
    });
    expect(api.register).toHaveBeenCalledWith({
      email: "ada@example.com",
      password: "correct horse battery",
      displayName: "Ada",
    });
    expect(manager.getState().status).toBe("signed-in");
    expect(getAccessToken()).toBe("token-3");
  });

  it("a failed login rethrows the error and changes nothing", async () => {
    const { manager, api, timers } = setup({ csrf: undefined });
    await manager.start();
    const failure = apiError(401);
    api.login.mockRejectedValue(failure);
    await expect(manager.login({ email: "a@b.test", password: "x" })).rejects.toBe(failure);
    expect(manager.getState()).toEqual({ status: "signed-out" });
    expect(getAccessToken()).toBeUndefined();
    expect(timers).toHaveLength(0);
  });

  it("a failed register rethrows the error and changes nothing", async () => {
    const { manager, api } = setup({ csrf: undefined });
    await manager.start();
    const failure = apiError(409);
    api.register.mockRejectedValue(failure);
    await expect(manager.register({ email: "a@b.test", password: "x" })).rejects.toBe(failure);
    expect(manager.getState()).toEqual({ status: "signed-out" });
  });
});

describe("session manager: refreshing", () => {
  it("shares one request between many callers at the same time", async () => {
    const { manager, api } = setup();
    api.refresh.mockResolvedValueOnce(session("token-1"));
    await manager.start();
    api.refresh.mockReset();
    const pending = deferred<SessionResponse>();
    api.refresh.mockReturnValue(pending.promise);
    const results = Promise.all([1, 2, 3, 4, 5].map(() => manager.refresh()));
    pending.resolve(session("token-shared"));
    expect(await results).toEqual([true, true, true, true, true]);
    expect(api.refresh).toHaveBeenCalledTimes(1);
  });

  it("makes a new request for a later caller", async () => {
    const { manager, api } = setup();
    api.refresh.mockResolvedValue(session());
    await manager.start();
    await manager.refresh();
    await manager.refresh();
    expect(api.refresh).toHaveBeenCalledTimes(3);
  });

  it("returns false and signs out without a request when the CSRF cookie is gone", async () => {
    const { manager, api, setCsrf } = setup();
    api.refresh.mockResolvedValue(session());
    await manager.start();
    api.refresh.mockClear();
    setCsrf(undefined);
    expect(await manager.refresh()).toBe(false);
    expect(api.refresh).not.toHaveBeenCalled();
    expect(manager.getState()).toEqual({ status: "signed-out" });
    expect(getAccessToken()).toBeUndefined();
  });

  it("stays signed in when a later refresh fails because of the network", async () => {
    const { manager, api } = setup();
    api.refresh.mockResolvedValueOnce(session("token-1"));
    await manager.start();
    api.refresh.mockRejectedValue(new NetworkError());
    expect(await manager.refresh()).toBe(false);
    expect(manager.getState().status).toBe("signed-in");
    expect(getAccessToken()).toBe("token-1");
  });

  it("stays signed in when a later refresh fails because the server is down", async () => {
    const { manager, api } = setup();
    api.refresh.mockResolvedValueOnce(session("token-1"));
    await manager.start();
    api.refresh.mockRejectedValue(apiError(503));
    expect(await manager.refresh()).toBe(false);
    expect(manager.getState().status).toBe("signed-in");
  });

  it("signs out when a later refresh is refused for good", async () => {
    const { manager, api } = setup();
    api.refresh.mockResolvedValueOnce(session("token-1"));
    await manager.start();
    api.refresh.mockRejectedValue(apiError(401));
    expect(await manager.refresh()).toBe(false);
    expect(manager.getState()).toEqual({ status: "signed-out" });
    expect(getAccessToken()).toBeUndefined();
  });

  it("keeps the same state object when the user did not change, so nothing re-renders", async () => {
    const { manager, api } = setup();
    api.refresh.mockResolvedValue(session("token-1"));
    await manager.start();
    const before = manager.getState();
    const listener = vi.fn();
    manager.subscribe(listener);
    api.refresh.mockResolvedValue(session("token-2", 900, { ...USER }));
    await manager.refresh();
    expect(manager.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe("token-2");
  });

  it("publishes a new state when the user changed", async () => {
    const { manager, api } = setup();
    api.refresh.mockResolvedValue(session("token-1"));
    await manager.start();
    const listener = vi.fn();
    manager.subscribe(listener);
    api.refresh.mockResolvedValue(session("token-2", 900, { ...USER, displayName: "Ada L." }));
    await manager.refresh();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(manager.getState()).toEqual({
      status: "signed-in",
      user: { ...USER, displayName: "Ada L." },
    });
  });
});

describe("session manager: the refresh timer", () => {
  it("fires 60 seconds before a 15 minute token expires", async () => {
    const { manager, api, timers } = setup();
    api.refresh.mockResolvedValue(session("token-1", 900));
    await manager.start();
    expect(timers).toHaveLength(1);
    expect(timers[0]?.ms).toBe(840_000);
  });

  it("fires at half the lifetime for a short token, never in a tight loop", async () => {
    const { manager, api, timers } = setup();
    api.refresh.mockResolvedValue(session("token-1", 60));
    await manager.start();
    expect(timers[0]?.ms).toBe(30_000);
  });

  it("never asks for a delay a browser timer cannot hold, which would fire at once and loop", async () => {
    const { manager, api, timers } = setup();
    api.refresh.mockResolvedValue(session("token-1", 60 * 60 * 24 * 40));
    await manager.start();
    expect(timers[0]?.ms).toBe(2_147_483_647);
  });

  it("uses half a second for a one second token", async () => {
    const { manager, api, timers } = setup();
    api.refresh.mockResolvedValue(session("token-1", 1));
    await manager.start();
    expect(timers[0]?.ms).toBe(500);
  });

  it("refreshes when the timer fires and schedules the next one", async () => {
    const { manager, api, timers } = setup();
    api.refresh.mockResolvedValueOnce(session("token-1", 900));
    await manager.start();
    api.refresh.mockResolvedValueOnce(session("token-2", 900));

    timers[0]?.callback();

    await vi.waitFor(() => expect(getAccessToken()).toBe("token-2"));
    expect(api.refresh).toHaveBeenCalledTimes(2);
    expect(timers).toHaveLength(2);
    expect(timers[0]?.cancelled).toBe(true);
    expect(timers[1]?.cancelled).toBe(false);
  });

  it("signs out when the timer's refresh is refused for good", async () => {
    const { manager, api, timers } = setup();
    api.refresh.mockResolvedValueOnce(session("token-1", 900));
    await manager.start();
    api.refresh.mockRejectedValue(apiError(401));

    timers[0]?.callback();

    await vi.waitFor(() => expect(manager.getState()).toEqual({ status: "signed-out" }));
  });

  it("reports an unexpected failure of the timer's refresh instead of losing it", async () => {
    const { manager, api, timers, reportError } = setup();
    api.refresh.mockResolvedValueOnce(session("token-1", 900));
    await manager.start();
    const surprise = new TypeError("something is broken");
    api.refresh.mockRejectedValue(surprise);

    timers[0]?.callback();

    await vi.waitFor(() => expect(reportError).toHaveBeenCalledExactlyOnceWith(surprise));
    expect(manager.getState().status).toBe("signed-in");
  });

  it("does not schedule another timer when the timer's refresh fails for a passing reason", async () => {
    const { manager, api, timers } = setup();
    api.refresh.mockResolvedValueOnce(session("token-1", 900));
    await manager.start();
    api.refresh.mockRejectedValue(new NetworkError());

    timers[0]?.callback();

    await vi.waitFor(() => expect(api.refresh).toHaveBeenCalledTimes(2));
    expect(manager.getState().status).toBe("signed-in");
    expect(timers).toHaveLength(1);
  });

  it("does not arm a timer when stop() was called before the restore finished", async () => {
    const { manager, api, liveTimers } = setup();
    const pending = deferred<SessionResponse>();
    api.refresh.mockReturnValue(pending.promise);
    const started = manager.start();
    manager.stop();
    pending.resolve(session("token-1"));
    await started;
    expect(manager.getState().status).toBe("signed-in");
    expect(liveTimers()).toHaveLength(0);
  });

  it("stop() cancels the timer", async () => {
    const { manager, api, liveTimers } = setup();
    api.refresh.mockResolvedValue(session());
    await manager.start();
    expect(liveTimers()).toHaveLength(1);
    manager.stop();
    expect(liveTimers()).toHaveLength(0);
  });

  it("start() after stop() re-arms the timer from the time that is left", async () => {
    const { manager, api, timers, advance } = setup();
    api.refresh.mockResolvedValue(session("token-1", 900));
    await manager.start();
    manager.stop();
    advance(100_000);

    await manager.start();

    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(timers).toHaveLength(2);
    expect(timers[1]?.ms).toBe(740_000);
  });

  it("start() after stop() refreshes at once when the token has already expired", async () => {
    const { manager, api, timers, advance } = setup();
    api.refresh.mockResolvedValue(session("token-1", 900));
    await manager.start();
    manager.stop();
    advance(1_000_000);

    await manager.start();

    expect(timers[1]?.ms).toBe(0);
  });

  it("a new session replaces the old timer", async () => {
    const { manager, api, timers, liveTimers } = setup();
    api.refresh.mockResolvedValue(session("token-1"));
    await manager.start();
    api.login.mockResolvedValue(session("token-2"));
    await manager.login({ email: "a@b.test", password: "x" });
    expect(timers).toHaveLength(2);
    expect(liveTimers()).toHaveLength(1);
  });
});

describe("session manager: withAuth", () => {
  async function signedIn() {
    const context = setup();
    context.api.refresh.mockResolvedValueOnce(session("token-1"));
    await context.manager.start();
    context.api.refresh.mockClear();
    return context;
  }

  it("returns the result when the call works", async () => {
    const { manager, api } = await signedIn();
    const call = vi.fn().mockResolvedValue("result");
    await expect(manager.withAuth(call)).resolves.toBe("result");
    expect(call).toHaveBeenCalledTimes(1);
    expect(api.refresh).not.toHaveBeenCalled();
  });

  it("refreshes once and retries once after a 401", async () => {
    const { manager, api } = await signedIn();
    api.refresh.mockResolvedValue(session("token-2"));
    const call = vi.fn().mockRejectedValueOnce(apiError(401)).mockResolvedValueOnce("result");
    await expect(manager.withAuth(call)).resolves.toBe("result");
    expect(call).toHaveBeenCalledTimes(2);
    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBe("token-2");
  });

  it("never loops: a second 401 is thrown as it is", async () => {
    const { manager, api } = await signedIn();
    api.refresh.mockResolvedValue(session("token-2"));
    const second = apiError(401);
    const call = vi.fn().mockRejectedValueOnce(apiError(401)).mockRejectedValueOnce(second);
    await expect(manager.withAuth(call)).rejects.toBe(second);
    expect(call).toHaveBeenCalledTimes(2);
    expect(api.refresh).toHaveBeenCalledTimes(1);
  });

  it("throws the original 401 and signs out when the refresh is refused for good", async () => {
    const { manager, api } = await signedIn();
    api.refresh.mockRejectedValue(apiError(401));
    const original = apiError(401);
    const call = vi.fn().mockRejectedValue(original);
    await expect(manager.withAuth(call)).rejects.toBe(original);
    expect(call).toHaveBeenCalledTimes(1);
    expect(manager.getState()).toEqual({ status: "signed-out" });
  });

  it("throws the original 401 and stays signed in when the refresh fails for a passing reason", async () => {
    const { manager, api } = await signedIn();
    api.refresh.mockRejectedValue(new NetworkError());
    const original = apiError(401);
    const call = vi.fn().mockRejectedValue(original);
    await expect(manager.withAuth(call)).rejects.toBe(original);
    expect(manager.getState().status).toBe("signed-in");
  });

  it.each([
    ["a 400", apiError(400)],
    ["a 403", apiError(403)],
    ["a 404", apiError(404)],
    ["a 500", apiError(500)],
    ["a network error", new NetworkError()],
    ["a plain error", new Error("boom")],
  ])("does not refresh after %s", async (_name, error) => {
    const { manager, api } = await signedIn();
    const call = vi.fn().mockRejectedValue(error);
    await expect(manager.withAuth(call)).rejects.toBe(error);
    expect(api.refresh).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("shares one refresh between calls that fail at the same time", async () => {
    const { manager, api } = await signedIn();
    const pending = deferred<SessionResponse>();
    api.refresh.mockReturnValue(pending.promise);
    const makeCall = () => vi.fn().mockRejectedValueOnce(apiError(401)).mockResolvedValueOnce("ok");
    const results = Promise.all([
      manager.withAuth(makeCall()),
      manager.withAuth(makeCall()),
      manager.withAuth(makeCall()),
    ]);
    await vi.waitFor(() => expect(api.refresh).toHaveBeenCalledTimes(1));
    pending.resolve(session("token-2"));
    await expect(results).resolves.toEqual(["ok", "ok", "ok"]);
    expect(api.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("session manager: signing out", () => {
  async function signedIn() {
    const context = setup();
    context.api.refresh.mockResolvedValueOnce(session("token-1"));
    await context.manager.start();
    return context;
  }

  it("calls the server, forgets the token, cancels the timer and signs out", async () => {
    const { manager, api, liveTimers } = await signedIn();
    expect(await manager.signOut()).toBe(true);
    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(manager.getState()).toEqual({ status: "signed-out" });
    expect(getAccessToken()).toBeUndefined();
    expect(liveTimers()).toHaveLength(0);
  });

  it("still signs out here when the server cannot be reached, and says so", async () => {
    const { manager, api } = await signedIn();
    api.logout.mockRejectedValue(new NetworkError());
    expect(await manager.signOut()).toBe(false);
    expect(manager.getState()).toEqual({ status: "signed-out" });
    expect(getAccessToken()).toBeUndefined();
  });

  it("still signs out here when the server refuses the logout, and says so", async () => {
    const { manager, api } = await signedIn();
    api.logout.mockRejectedValue(apiError(403));
    expect(await manager.signOut()).toBe(false);
    expect(manager.getState()).toEqual({ status: "signed-out" });
  });

  it("signs out here even before the server has answered", async () => {
    const { manager, api } = await signedIn();
    const pending = deferred<undefined>();
    api.logout.mockReturnValue(pending.promise);
    const result = manager.signOut();
    expect(manager.getState()).toEqual({ status: "signed-out" });
    expect(getAccessToken()).toBeUndefined();
    pending.resolve(undefined);
    expect(await result).toBe(true);
  });

  it("is not undone by a refresh that finishes afterwards", async () => {
    const { manager, api, liveTimers } = await signedIn();
    const pending = deferred<SessionResponse>();
    api.refresh.mockReturnValue(pending.promise);
    const refreshing = manager.refresh();

    await manager.signOut();
    pending.resolve(session("token-late"));

    expect(await refreshing).toBe(false);
    expect(manager.getState()).toEqual({ status: "signed-out" });
    expect(getAccessToken()).toBeUndefined();
    expect(liveTimers()).toHaveLength(0);
  });

  it("is not undone by a refresh that fails for good afterwards either", async () => {
    const { manager, api } = await signedIn();
    const pending = deferred<SessionResponse>();
    api.refresh.mockReturnValue(pending.promise);
    const refreshing = manager.refresh();
    await manager.signOut();
    pending.reject(apiError(401));
    expect(await refreshing).toBe(false);
    expect(manager.getState()).toEqual({ status: "signed-out" });
  });

  it("works when nobody is signed in", async () => {
    const { manager, api } = setup({ csrf: undefined });
    await manager.start();
    expect(await manager.signOut()).toBe(true);
    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(manager.getState()).toEqual({ status: "signed-out" });
  });
});

describe("session manager: subscribing", () => {
  it("returns a stable state object between changes", async () => {
    const { manager } = setup({ csrf: undefined });
    expect(manager.getState()).toBe(manager.getState());
    await manager.start();
    expect(manager.getState()).toBe(manager.getState());
  });

  it("stops notifying after unsubscribing", async () => {
    const { manager, api } = setup();
    const listener = vi.fn();
    const unsubscribe = manager.subscribe(listener);
    unsubscribe();
    api.refresh.mockResolvedValue(session());
    await manager.start();
    expect(listener).not.toHaveBeenCalled();
  });

  it("notifies every listener", async () => {
    const { manager, api } = setup();
    const first = vi.fn();
    const second = vi.fn();
    manager.subscribe(first);
    manager.subscribe(second);
    api.refresh.mockResolvedValue(session());
    await manager.start();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("does not notify when the state stays the same", async () => {
    const { manager } = setup({ csrf: undefined });
    await manager.start();
    const listener = vi.fn();
    manager.subscribe(listener);
    await manager.signOut();
    expect(listener).not.toHaveBeenCalled();
  });
});
