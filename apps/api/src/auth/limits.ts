export interface RateRule {
  readonly max: number;
  readonly windowSeconds: number;
}

/** How often each auth route may be used. Per client address, except `loginPerEmail`. */
export interface AuthLimits {
  readonly register: RateRule;
  readonly login: RateRule;
  /** Attempts on one email address, from any address. Slows down a spread-out guessing attack. */
  readonly loginPerEmail: RateRule;
  readonly refresh: RateRule;
  readonly logout: RateRule;
}

/**
 * Stricter than the global limit on the routes that cost CPU or can be guessed at. The per-email
 * rule can lock a victim out of logging in for 15 minutes; the alternative is letting a spread-out
 * guessing attack through, which is worse.
 */
export const DEFAULT_AUTH_LIMITS: AuthLimits = {
  register: { max: 10, windowSeconds: 3600 },
  login: { max: 10, windowSeconds: 60 },
  loginPerEmail: { max: 10, windowSeconds: 900 },
  refresh: { max: 30, windowSeconds: 60 },
  logout: { max: 30, windowSeconds: 60 },
};
