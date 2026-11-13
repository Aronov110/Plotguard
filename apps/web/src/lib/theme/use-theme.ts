import { useCallback, useEffect, useState } from "react";
import {
  applyPreference,
  readPreference,
  THEME_STORAGE_KEY,
  type ThemePreference,
  writePreference,
} from "./theme.ts";

export interface UseTheme {
  readonly preference: ThemePreference;
  /** Saves the choice and puts it on the page at once. */
  readonly setPreference: (preference: ThemePreference) => void;
}

/**
 * The colour theme the person chose, and a way to change it. The page is marked before the first
 * paint by `public/theme-init.js`; this keeps the mark and the saved choice in step afterwards, also
 * when the choice is changed in another tab of the same browser.
 */
export function useTheme(): UseTheme {
  const [preference, setState] = useState<ThemePreference>(() => readPreference());

  // Makes sure the page carries the mark even when the early script did not run.
  useEffect(() => {
    applyPreference(preference);
  }, [preference]);

  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      // A null key means the whole storage was cleared.
      if (event.key === null || event.key === THEME_STORAGE_KEY) setState(readPreference());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference): void => {
    writePreference(next);
    setState(next);
  }, []);

  return { preference, setPreference };
}
