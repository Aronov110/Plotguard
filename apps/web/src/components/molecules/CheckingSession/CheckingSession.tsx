import type { ReactElement } from "react";
import { PageHeading } from "../../atoms/PageHeading/PageHeading.tsx";
import "./CheckingSession.css";

/**
 * What a guarded screen shows while the app finds out whether a login exists (a moment after the
 * page opens, if a login cookie is there). It shows no form and no private content, so nothing can
 * be used, or leak, before the answer is known.
 */
export function CheckingSession(): ReactElement {
  return (
    <main id="main-content" className="checking-session">
      <PageHeading>Plotpal</PageHeading>
      <p role="status">Checking your session…</p>
    </main>
  );
}
