// Tests plant and remove cookies through `document.cookie`. Biome prefers the Cookie Store API,
// but jsdom (the test browser) does not have it, and the code under test reads `document.cookie`
// too. These two helpers are the only places that write it.

/** Plants a cookie the way the API would: visible to the page, valid for the whole site. */
export function setCookie(name: string, value: string): void {
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom has no Cookie Store API
  document.cookie = `${name}=${value}; path=/`;
}

/** Deletes every cookie the test page can see, so one test never leaks cookies into the next. */
export function clearAllCookies(): void {
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name) {
      // biome-ignore lint/suspicious/noDocumentCookie: jsdom has no Cookie Store API
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
  }
}
