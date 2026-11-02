import { vi } from "vitest";
import type { AuthApi, PublicUser, SessionResponse } from "../lib/api/auth-api.ts";
import { ApiError } from "../lib/api/problem.ts";
import type { AuthBroadcast } from "../lib/auth/auth-channel.ts";
import { createSessionManager } from "../lib/auth/session-manager.ts";

export const USER: PublicUser = { id: "user-1", email: "ada@example.com", displayName: null };

export function session(
  accessToken = "token-1",
  expiresIn = 900,
  user: PublicUser = USER,
): SessionResponse {
  return { user, accessToken, expiresIn };
}

export function apiError(status: number): ApiError {
  return new ApiError({
    status,
    code: undefined,
    detail: undefined,
    issues: [],
    retryAfterSeconds: undefined,
  });
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export interface FakeTimer {
  /** Fires the timer. After that it is finished, like a real one, and no longer "live". */
  readonly callback: () => void;
  readonly ms: number;
  cancelled: boolean;
  fired: boolean;
}

/** A stand-in for the link between tabs: tests make "another tab" speak with `emit`. */
export function createFakeBroadcast() {
  const listeners = new Set<() => void>();
  const announceSignOut = vi.fn<AuthBroadcast["announceSignOut"]>();
  const onSignOut = vi.fn<AuthBroadcast["onSignOut"]>((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  });
  return {
    announceSignOut,
    onSignOut,
    /** Another tab announces that it signed out. */
    emit: () => {
      for (const listener of [...listeners]) listener();
    },
    listenerCount: () => listeners.size,
  };
}

/**
 * A session manager wired to fakes: an API whose calls tests script, a clock and timers they
 * control, a cookie they set, and a fake link between tabs.
 */
// A default parameter would turn an explicit `undefined` back into the default value, so "no CSRF
// cookie" is passed as `{ csrf: undefined }` and detected with `in`.
export function setup(options: { csrf?: string | undefined } = {}) {
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
  const broadcast = createFakeBroadcast();

  const manager = createSessionManager({
    api,
    readCsrf: () => csrf,
    now: () => clock,
    wait,
    reportError,
    broadcast,
    setTimer: (callback, ms) => {
      const timer: FakeTimer = {
        callback: () => {
          timer.fired = true;
          callback();
        },
        ms,
        cancelled: false,
        fired: false,
      };
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
    broadcast,
    liveTimers: () => timers.filter((timer) => !timer.cancelled && !timer.fired),
    setCsrf: (value: string | undefined) => {
      csrf = value;
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}
