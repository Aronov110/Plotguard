// The access token lives in this variable and nowhere else. It is never written to localStorage,
// sessionStorage, IndexedDB or a cookie: any script on the page can read those, and the token
// would then outlive the tab. A page reload clears it; the session restores it with the refresh
// cookie (see `session-manager.ts`).
let accessToken: string | undefined;

/** The current access token, or `undefined` when nobody is signed in. */
export function getAccessToken(): string | undefined {
  return accessToken;
}

/** Remembers the access token for this tab only. */
export function setAccessToken(token: string): void {
  accessToken = token;
}

/** Forgets the access token. */
export function clearAccessToken(): void {
  accessToken = undefined;
}
