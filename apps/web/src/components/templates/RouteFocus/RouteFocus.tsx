import { useEffect, useRef } from "react";
import { useLocation } from "react-router";

/**
 * Moves the focus to the heading of the new screen after a navigation. A single-page app swaps
 * the screen without loading a page, so a screen reader would otherwise stay silent and a keyboard
 * user would stay wherever the old screen left them.
 *
 * It does nothing when the app first opens (the browser handles that), and nothing when only the
 * query or fragment changes on the same screen. Place it once, inside the router.
 */
export function RouteFocus(): null {
  const { pathname } = useLocation();
  // Compared with the last path instead of "is this the first run": React's StrictMode runs every
  // effect twice while developing, which would count as a navigation.
  const lastPath = useRef(pathname);

  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    document.querySelector<HTMLElement>("main h1")?.focus();
  }, [pathname]);

  return null;
}
