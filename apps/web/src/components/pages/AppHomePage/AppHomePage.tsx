import type { ReactElement } from "react";
import { usePageTitle } from "../../../lib/navigation/use-page-title.ts";
import { PageHeading } from "../../atoms/PageHeading/PageHeading.tsx";
import { AppLayout } from "../../templates/AppLayout/AppLayout.tsx";

/** A placeholder for the signed-in home. The project list replaces it in a later step. */
export function AppHomePage(): ReactElement {
  usePageTitle("Your projects");

  return (
    <AppLayout>
      <PageHeading>Your projects</PageHeading>
      <p>Your projects will appear here. This part of Plotpal is still being built.</p>
    </AppLayout>
  );
}
