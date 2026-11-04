import type { ReactElement } from "react";
import { usePageTitle } from "../../../lib/navigation/use-page-title.ts";
import { ButtonLink } from "../../atoms/ButtonLink/ButtonLink.tsx";
import { PageHeading } from "../../atoms/PageHeading/PageHeading.tsx";
import "./NotFoundPage.css";

/** Shown for every address the app does not know. It never repeats the address back. */
export function NotFoundPage(): ReactElement {
  usePageTitle("Page not found");

  return (
    <main id="main-content" className="not-found-page">
      <PageHeading>Page not found</PageHeading>
      <p>That page does not exist, or it has moved.</p>
      <ButtonLink to="/">Go to the home page</ButtonLink>
    </main>
  );
}
