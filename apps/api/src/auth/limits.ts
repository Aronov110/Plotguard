export interface RateRule {
  readonly max: number;
  readonly windowSeconds: number;
}

/** How often each auth route may be used. */
export interface AuthLimits {
  /** Per client address. */
  readonly register: RateRule;
  /** Per client address; every request counts, whether the password was right or not. */
  readonly login: RateRule;
  /**
   * FAILED logins for one email from one address. Reaching it blocks that pair only, so the owner
   * can still sign in from another address while a guesser is stuck.
   */
  readonly loginFailuresPerEmailAndIp: RateRule;
  /**
   * FAILED logins for one email from anywhere. A much higher ceiling that caps a guessing attack
   * spread over many addresses. Reaching it locks the account's login for the rest of the window,
   * so it must stay expensive to reach: it takes this many failures, and correct logins do not count.
   */
  readonly loginFailuresPerEmail: RateRule;
  /** Per client address. */
  readonly refresh: RateRule;
  /** Per client address. */
  readonly logout: RateRule;
}

/**
 * Stricter than the global limit on the routes that cost CPU or can be guessed at. Only failed
 * logins count towards the per-email limits: counting every login let a user's own sign-ins from
 * several devices use up the budget, and let anyone who knew an address lock that user out.
 */
export const DEFAULT_AUTH_LIMITS: AuthLimits = {
  register: { max: 10, windowSeconds: 3600 },
  login: { max: 10, windowSeconds: 60 },
  loginFailuresPerEmailAndIp: { max: 5, windowSeconds: 900 },
  loginFailuresPerEmail: { max: 50, windowSeconds: 900 },
  refresh: { max: 30, windowSeconds: 60 },
  logout: { max: 30, windowSeconds: 60 },
};
