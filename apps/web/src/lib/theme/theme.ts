/**
 * The colour theme a person chose: follow the system (the default), or always light, or always dark.
 * It is only a preference, so it is kept in the browser's `localStorage` (never a token or anything
 * private). `public/theme-init.js` reads the same key before the first paint so that the page never
 * flashes the wrong colours; `theme-init.test.ts` checks that both agree.
 */
export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "plotpal-theme";

const PREFERENCES: readonly string[] = ["system", "light", "dark"];

/** Whether a value is one of the three words. Anything else a stored value might be is refused. */
export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && PREFERENCES.includes(value);
}

/** The part of `localStorage` that reading needs; a missing or blocked storage reads as "system". */
export type ReadableStorage = Pick<Storage, "getItem">;
export type WritableStorage = Pick<Storage, "setItem" | "removeItem">;

/** The page's `localStorage`, or `undefined` when the browser blocks it (a private window, say). */
export function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** The saved preference. A missing, blocked or meaningless value is "system". */
export function readPreference(
  storage: ReadableStorage | undefined = browserStorage(),
): ThemePreference {
  try {
    const stored = storage?.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

/** Saves the preference. "system" is the default, so it is saved by forgetting the value. */
export function writePreference(
  preference: ThemePreference,
  storage: WritableStorage | undefined = browserStorage(),
): void {
  try {
    if (preference === "system") storage?.removeItem(THEME_STORAGE_KEY);
    else storage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The preference only lasts until the page is closed. Nothing is lost that matters.
  }
}

/** Marks the page with the chosen theme, or removes the mark so that the system's setting decides. */
export function applyPreference(
  preference: ThemePreference,
  root: HTMLElement = document.documentElement,
): void {
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
}
