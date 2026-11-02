import {
  type AuthApi,
  authApi,
  type LoginInput,
  type PublicUser,
  type RegisterInput,
  type SessionResponse,
} from "../api/auth-api.ts";
import { ApiError, NetworkError } from "../api/problem.ts";
import { readCsrfToken } from "./csrf-cookie.ts";
import { clearAccessToken, setAccessToken } from "./token-store.ts";

/** How long before the access token expires the next refresh is started. */
const REFRESH_LEAD_MS = 60_000;
/** Tokens with less than this left are refreshed at half their remaining life instead. */
const SHORT_TOKEN_MS = 2 * REFRESH_LEAD_MS;
/** How long to wait before retrying a refresh that lost a race against another tab. */
const RACE_WAIT_MS = 300;

export type SessionState =
  | { readonly status: "loading" }
  | { readonly status: "signed-out" }
  | { readonly status: "signed-in"; readonly user: PublicUser };

export interface SessionManagerDeps {
  readonly api: AuthApi;
  /** The CSRF code from the cookie. Its absence means there is no login to restore or renew. */
  readonly readCsrf: () => string | undefined;
  readonly now: () => number;
  /** Runs `callback` after `ms` milliseconds. Returns a function that cancels it. */
  readonly setTimer: (callback: () => void, ms: number) => () => void;
  readonly wait: (ms: number) => Promise<void>;
  /** Receives failures nobody expected (a bug, an API answer in the wrong shape). */
  readonly reportError: (error: unknown) => void;
}

export interface SessionManager {
  /** The current state. The same object is returned until the state really changes. */
  getState(): SessionState;
  /** Calls `listener` after every change. Returns a function that stops the calls. */
  subscribe(listener: () => void): () => void;
  /**
   * Starts the session: restores a login from the cookies, or re-arms the refresh timer after
   * {@link SessionManager.stop}. Safe to call several times. Never rejects.
   */
  start(): Promise<void>;
  /** Cancels the refresh timer, for example when the page unmounts. */
  stop(): void;
  /** @throws ApiError, NetworkError or ResponseShapeError; the state does not change then. */
  login(input: LoginInput): Promise<void>;
  /** @throws ApiError, NetworkError or ResponseShapeError; the state does not change then. */
  register(input: RegisterInput): Promise<void>;
  /**
   * Signs out on this page at once, then tells the server.
   * @returns whether the server confirmed. `false` means the login cookie may still be valid.
   */
  signOut(): Promise<boolean>;
  /**
   * Renews the access token. At most one request runs at a time, however many callers ask.
   * @returns whether a new token was obtained. Never rejects for expected failures.
   */
  refresh(): Promise<boolean>;
  /**
   * Runs an API call that needs the access token. If it fails with a 401 (the token expired, for
   * example because a background tab's timer was slowed down) it renews the token and tries once more.
   */
  withAuth<T>(call: () => Promise<T>): Promise<T>;
}

const LOADING: SessionState = { status: "loading" };
const SIGNED_OUT: SessionState = { status: "signed-out" };

const defaultDeps: SessionManagerDeps = {
  api: authApi,
  readCsrf: () => readCsrfToken(),
  now: () => Date.now(),
  setTimer: (callback, ms) => {
    const id = setTimeout(callback, ms);
    return () => clearTimeout(id);
  },
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  reportError: (error) => {
    console.error(error);
  },
};

/** Failures that are part of normal life: the answer was an error, or there was no answer. */
function isExpected(error: unknown): boolean {
  return error instanceof ApiError || error instanceof NetworkError;
}

/** The server said this login is over (or the CSRF code is wrong), so renewing cannot work. */
function isRefused(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

function sameUser(a: PublicUser, b: PublicUser): boolean {
  return a.id === b.id && a.email === b.email && a.displayName === b.displayName;
}

/**
 * The longest delay a browser timer holds (a signed 32-bit number of milliseconds, about 24.8
 * days). A longer one overflows and fires at once, which would make a very long-lived token
 * refresh in a tight loop. Firing early is harmless: the refresh just schedules the next one.
 */
const MAX_TIMER_MS = 2_147_483_647;

/** When to refresh, given how long the token still lives. Never sooner than half its life. */
function refreshDelay(remainingMs: number): number {
  if (remainingMs <= 0) return 0;
  const delay = remainingMs > SHORT_TOKEN_MS ? remainingMs - REFRESH_LEAD_MS : remainingMs / 2;
  return Math.min(delay, MAX_TIMER_MS);
}

/**
 * Creates the object that owns the login of this tab: restores it after a page load, keeps the
 * access token fresh and signs in and out. It has no React in it, so the timing rules can be
 * tested without a browser; `session.tsx` connects it to React.
 */
export function createSessionManager(overrides: Partial<SessionManagerDeps> = {}): SessionManager {
  const deps: SessionManagerDeps = { ...defaultDeps, ...overrides };
  const listeners = new Set<() => void>();

  let state: SessionState = LOADING;
  let running = false;
  let expiresAt = 0;
  let cancelTimer: (() => void) | undefined;
  let restoring: Promise<void> | undefined;
  let refreshing: Promise<boolean> | undefined;
  // Counts "the login changed under you" events (sign-out, a new login). A refresh that started
  // before one of them must not bring the old login back to life when its answer arrives.
  let epoch = 0;

  function setState(next: SessionState): void {
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  }

  function cancelSchedule(): void {
    cancelTimer?.();
    cancelTimer = undefined;
  }

  function schedule(): void {
    cancelSchedule();
    if (!running) return;
    cancelTimer = deps.setTimer(
      () => {
        refresh().catch(deps.reportError);
      },
      refreshDelay(expiresAt - deps.now()),
    );
  }

  function applySession(session: SessionResponse): void {
    setAccessToken(session.accessToken);
    expiresAt = deps.now() + session.expiresIn * 1000;
    // Keep the old state object when nothing changed, so a silent refresh re-renders nothing.
    if (!(state.status === "signed-in" && sameUser(state.user, session.user))) {
      setState({ status: "signed-in", user: session.user });
    }
    schedule();
  }

  function endSession(): void {
    epoch++;
    clearAccessToken();
    cancelSchedule();
    setState(SIGNED_OUT);
  }

  async function requestRefresh(): Promise<SessionResponse> {
    try {
      return await deps.api.refresh();
    } catch (error) {
      // Two tabs can refresh at the same moment. The loser's refresh token was already rotated by
      // the winner, so it gets a 401 although the login is fine. Wait for the winner's new cookie
      // to arrive, then try once more; the request reads the cookie again.
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      await deps.wait(RACE_WAIT_MS);
      return deps.api.refresh();
    }
  }

  async function doRefresh(): Promise<boolean> {
    // Without the CSRF cookie the server would refuse the request, and it means there is no login.
    if (deps.readCsrf() === undefined) {
      endSession();
      return false;
    }

    const startedIn = epoch;
    let session: SessionResponse;
    try {
      session = await requestRefresh();
    } catch (error) {
      if (epoch === startedIn && isRefused(error)) endSession();
      if (!isExpected(error)) throw error;
      return false;
    }

    if (epoch !== startedIn) return false;
    applySession(session);
    return true;
  }

  function refresh(): Promise<boolean> {
    refreshing ??= doRefresh().finally(() => {
      refreshing = undefined;
    });
    return refreshing;
  }

  async function restore(): Promise<void> {
    try {
      await refresh();
    } catch (error) {
      deps.reportError(error);
    }
    if (state.status === "loading") setState(SIGNED_OUT);
  }

  function beginSession(session: SessionResponse): void {
    epoch++;
    applySession(session);
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    start() {
      running = true;
      if (state.status === "loading") {
        restoring ??= restore();
        return restoring;
      }
      if (state.status === "signed-in" && cancelTimer === undefined) schedule();
      return Promise.resolve();
    },

    stop() {
      running = false;
      cancelSchedule();
    },

    async login(input) {
      beginSession(await deps.api.login(input));
    },

    async register(input) {
      beginSession(await deps.api.register(input));
    },

    async signOut() {
      // Sign out on this page first: the person pressed the button, so the screen must not keep
      // showing their private pages while the request travels.
      endSession();
      try {
        await deps.api.logout();
        return true;
      } catch (error) {
        if (!isExpected(error)) throw error;
        return false;
      }
    },

    refresh,

    async withAuth<T>(call: () => Promise<T>): Promise<T> {
      try {
        return await call();
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        if (!(await refresh())) throw error;
        // One retry only. A second 401 is thrown as it is: no loops.
        return call();
      }
    },
  };
}
