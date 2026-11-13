import { useEffect, useRef } from "react";
import { useLocation } from "react-router";

/** Input types that take no typed text: a focused one is not a reason to keep the focus. */
const NOT_TEXT_INPUTS = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/**
 * Whether the focus is in something a person types into: a text field, a text area, a select or an
 * editable element. Taking the focus from there would send the next key press, or the text a test
 * is typing, into the heading, where it is lost.
 */
function isTypingInto(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element instanceof HTMLInputElement) return !NOT_TEXT_INPUTS.has(element.type);
  return (
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    // `isContentEditable` is missing in some test environments, so the attribute is read as well.
    element.isContentEditable ||
    element.closest('[contenteditable]:not([contenteditable="false"])') !== null
  );
}

/**
 * Moves the focus to the heading of the new screen after a navigation. A single-page app swaps
 * the screen without loading a page, so a screen reader would otherwise stay silent and a keyboard
 * user would stay wherever the old screen left them.
 *
 * It does nothing when the app first opens (the browser handles that), and nothing when only the
 * query or fragment changes on the same screen. It also leaves the focus alone when it is already in
 * a field (a login form that focuses its first field, or someone who has started typing): the
 * effect runs after the screen is painted, which on a slow machine is after typing has begun.
 * Place it once, inside the router.
 */
export function RouteFocus(): null {
  const { pathname } = useLocation();
  // Compared with the last path instead of "is this the first run": React's StrictMode runs every
  // effect twice while developing, which would count as a navigation.
  const lastPath = useRef(pathname);

  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (isTypingInto(document.activeElement)) return;
    document.querySelector<HTMLElement>("main h1")?.focus();
  }, [pathname]);

  return null;
}
