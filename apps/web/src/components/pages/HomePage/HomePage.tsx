import type { ReactElement } from "react";
import { useAuth } from "../../../lib/auth/session.tsx";
import { usePageTitle } from "../../../lib/navigation/use-page-title.ts";
import { ButtonLink } from "../../atoms/ButtonLink/ButtonLink.tsx";
import { PageHeading } from "../../atoms/PageHeading/PageHeading.tsx";
import "./HomePage.css";

/** The landing page. What it offers depends on whether someone is signed in. */
export function HomePage(): ReactElement {
  const { state } = useAuth();
  usePageTitle();

  return (
    <main id="main-content" className="home-page">
      <PageHeading>Plotpal</PageHeading>
      <p className="home-page__tagline">Write your story. Let AI catch what you missed.</p>
      {/* While the app still checks for a login, no action is offered: it would flicker. */}
      {state.status === "signed-out" ? (
        <div className="home-page__actions">
          <ButtonLink to="/register">Create account</ButtonLink>
          <ButtonLink to="/login" variant="secondary">
            Log in
          </ButtonLink>
        </div>
      ) : null}
      {state.status === "signed-in" ? (
        <div className="home-page__actions">
          <ButtonLink to="/app">Go to your projects</ButtonLink>
        </div>
      ) : null}
    </main>
  );
}
