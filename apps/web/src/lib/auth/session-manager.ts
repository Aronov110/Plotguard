import {
  type AuthApi,
  authApi,
  type LoginInput,
  type PublicUser,
  type RegisterInput,
  type SessionResponse,
} from "../api/auth-api.ts";
import { ApiError, NetworkError } from "../api/problem.ts";
import { type AuthBroadcast, createAuthBroadcast } from "./auth-channel.ts";
import { readCsrfToken } from "./csrf-cookie.ts";
import { clearAccessToken, setAccessToken } from "./token-store.ts";

/** How long before the access token expires the next refresh is started. */
const REFRESH_LEAD_MS = 60_000;
/** Tokens with less than this left are refreshed at half their remaining life instead. */
const SHORT_TOKEN_MS = 2 * REFRESH_LEAD_MS;
/** How long to wait before retrying a refresh that lost a race against another tab. */
const RACE_WAIT_MS = 300;
/** The first wait after a refresh failed for a passing reason; it doubles up to the maximum. */
const RETRY_BASE_MS = 5000;
const RETRY_MAX_MS = 60_000;
/**
 * The longest delay a browser timer holds (a signed 32-bit number of milliseconds, about 24.8
 * days). A longer one overflows and fires at once, which would make a very long-lived token
 * refresh in a tight loop. Firing early is harmless: the refresh just schedules the next one.
 */
const MAX_TIMER_MS = 2_147_483_647;

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
  /** The link to the other tabs of this browser. */
  readonly broadcast: AuthBroadcast;
}

export interface SessionManager {
  /** The current state. The same object is returned until the state really changes. */
  getState(): SessionState;
  /** Calls `listener` after every change. Returns a function that stops the calls. */
  subscribe(listener: () => void): () => void;
  /**
   * Starts the session: restores a login from the cookies, or re-arms the refresh timer after
   * {@link SessionManager.stop}. Also starts listening for a sign-out in another tab. Safe to call
   * several times. Never rejects.
   */
  start(): Promise<void>;
  /** Cancels the refresh timer and stops listening to other tabs, for example when the page unmounts. */
  stop(): void;
  /**
   * Signs in. If a sign-out request from this tab is still in flight, waits for it to finish
   * first (at most the request timeout), so its answer cannot delete the new login's cookies.
   * @throws ApiError, NetworkError or ResponseShapeError; the state does not change then.
   */
  login(input: LoginInput): Promise<void>;
  /**
   * Creates an account and signs in. Waits for a pending sign-out like {@link SessionManager.login}.
   * @throws ApiError, NetworkError or ResponseShapeError; the state does not change then.
   */
  register(input: RegisterInput): Promise<void>;
  /**
   * Signs out on this page at once, tells the other tabs, then tells the server.
   * @returns whether the server confirmed. `false` means the login cookie may still be valid.
   */
  signOut(): Promise<boolean>;
  /**
   * Renews the access token. At most one request runs at a time per login, however many callers
   * ask. Does nothing once the person has signed out.
   * @returns whether a new token was obtained. Never rejects for expected failures.
   */
  refresh(): Promise<boolean>;
  /**
   * Runs an API call that needs the access token. If it fails with a 401 (the token expired, for
   * example because a background tab's timer was slowed down) it renews the token and tries once
   * more. Every call that needs the token should go through here.
   */
  withAuth<T>(call: () => Promise<T>): Promise<T>;
}

/**
 * How a refresh ended: `ok` (new token), `refused` (the server ended this login), `transient` (no
 * answer or a server problem, worth trying again) or `stale` (the login changed meanwhile, so the
 * answer was thrown away).
 */
type RefreshOutcome = "ok" | "refused" | "transient" | "stale";

const LOADING: SessionState = { status: "loading" };
const SIGNED_OUT: SessionState = { status: "signed-out" };

function defaultDeps(): SessionManagerDeps {
  return {
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
    broadcast: createAuthBroadcast(),
  };
}

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
  const deps: SessionManagerDeps = { ...defaultDeps(), ...overrides };
  const listeners = new Set<() => void>();

  let state: SessionState = LOADING;
  let running = false;
  let expiresAt = 0;
  let cancelTimer: (() => void) | undefined;
  let stopListening: (() => void) | undefined;
  let restoring: Promise<void> | undefined;
  let refreshing: { readonly epoch: number; readonly promise: Promise<RefreshOutcome> } | undefined;
  // Counts "the login changed under you" events (sign-out, a new login). A refresh that started
  // before one of them must not bring the old login back to life when its answer arrives, and a
  // caller that comes after one must not wait for a refresh that belongs to the old login.
  let epoch = 0;
  // Sign-out requests that have been sent and not answered yet. Their answer deletes the login
  // cookies whenever it arrives, so a new login must not start before they are over (see `login`).
  const pendingLogouts = new Set<Promise<void>>();

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
        runScheduledRefresh(0).catch(deps.reportError);
      },
      refreshDelay(expiresAt - deps.now()),
    );
  }

  /**
   * The refresh the timer starts. When it fails for a passing reason (a laptop waking up offline,
   * a server restart) it tries again after 5 seconds, then 10, 20, 40 and every minute, for as long
   * as this login lasts. A success schedules the normal next refresh instead (see `applySession`).
   */
  async function runScheduledRefresh(failures: number): Promise<void> {
    const startedIn = epoch;
    const outcome = await attempt();
    if (outcome !== "transient" || !running || epoch !== startedIn) return;
    if (state.status !== "signed-in") return;
    const wait = Math.min(RETRY_BASE_MS * 2 ** failures, RETRY_MAX_MS);
    cancelTimer = deps.setTimer(() => {
      runScheduledRefresh(failures + 1).catch(deps.reportError);
    }, wait);
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

  function beginSession(session: SessionResponse): void {
    epoch++;
    applySession(session);
  }

  /** Sends the logout request and keeps it on the pending list until it succeeds or fails. */
  function sendLogout(): Promise<void> {
    const request: Promise<void> = (async () => {
      await deps.api.logout();
    })().finally(() => {
      pendingLogouts.delete(request);
    });
    pendingLogouts.add(request);
    return request;
  }

  /**
   * Resolves once no sign-out request is in flight. Loops because another sign-out can start while
   * this one waits. It cannot wait for long: every request ends by itself (the HTTP layer gives up
   * after its timeout). Never rejects; how a sign-out ended is its own caller's business.
   */
  async function whenLogoutsAreOver(): Promise<void> {
    while (pendingLogouts.size > 0) {
      await Promise.allSettled([...pendingLogouts]);
    }
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

  async function doRefresh(): Promise<RefreshOutcome> {
    // Nobody is signed in (or the person just signed out, possibly while the logout request is
    // still travelling and the cookies are still valid): never start a login from here.
    if (state.status === "signed-out") return "stale";
    // Without the CSRF cookie the server would refuse the request, and it means there is no login.
    if (deps.readCsrf() === undefined) {
      endSession();
      return "refused";
    }

    const startedIn = epoch;
    let session: SessionResponse;
    try {
      session = await requestRefresh();
    } catch (error) {
      if (!isExpected(error)) throw error;
      if (epoch !== startedIn) return "stale";
      if (isRefused(error)) {
        endSession();
        return "refused";
      }
      return "transient";
    }

    if (epoch !== startedIn) return "stale";
    applySession(session);
    return "ok";
  }

  /** Starts a refresh, or joins the one that is already running for this same login. */
  function attempt(): Promise<RefreshOutcome> {
    if (refreshing !== undefined && refreshing.epoch === epoch) return refreshing.promise;
    const promise: Promise<RefreshOutcome> = doRefresh().finally(() => {
      if (refreshing?.promise === promise) refreshing = undefined;
    });
    refreshing = { epoch, promise };
    return promise;
  }

  async function restore(): Promise<void> {
    try {
      await attempt();
    } catch (error) {
      deps.reportError(error);
    }
    if (state.status === "loading") setState(SIGNED_OUT);
  }

  /** Another tab signed out. This tab's access token would still work for a while: end it now. */
  function onOtherTabSignedOut(): void {
    if (state.status !== "signed-out") endSession();
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
      stopListening ??= deps.broadcast.onSignOut(onOtherTabSignedOut);
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
      stopListening?.();
      stopListening = undefined;
    },

    async login(input) {
      // Without this, a logout answer that arrives after the new login's answer would delete the
      // new cookies, and the next page load would find nobody signed in.
      if (pendingLogouts.size > 0) await whenLogoutsAreOver();
      beginSession(await deps.api.login(input));
    },

    async register(input) {
      if (pendingLogouts.size > 0) await whenLogoutsAreOver();
      beginSession(await deps.api.register(input));
    },

    async signOut() {
      // Sign out on this page first: the person pressed the button, so the screen must not keep
      // showing their private pages while the request travels. The other tabs hear about it at
      // once too; they would otherwise keep working until their own token expires.
      endSession();
      try {
        deps.broadcast.announceSignOut();
      } catch (error) {
        deps.reportError(error);
      }
      try {
        await sendLogout();
        return true;
      } catch (error) {
        if (!isExpected(error)) throw error;
        return false;
      }
    },

    async refresh() {
      return (await attempt()) === "ok";
    },

    async withAuth<T>(call: () => Promise<T>): Promise<T> {
      try {
        return await call();
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        if ((await attempt()) !== "ok") throw error;
        // One retry only. A second 401 is thrown as it is: no loops.
        return call();
      }
    },
  };
}
