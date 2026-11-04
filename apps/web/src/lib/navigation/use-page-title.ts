import { useEffect } from "react";

/**
 * Sets the title of the browser tab for the current screen. A single-page app never reloads, so
 * without this every screen would keep the title of the first one, and a screen reader user would
 * hear no sign that the page changed.
 *
 * @param title Leave it out for the landing page, which is just the name of the app.
 */
export function usePageTitle(title?: string): void {
  useEffect(() => {
    document.title = title === undefined ? "Plotpal" : `${title} – Plotpal`;
  }, [title]);
}
