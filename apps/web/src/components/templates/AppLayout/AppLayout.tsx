import { type ReactElement, type ReactNode, useState } from "react";
import { Link } from "react-router";
import { useAuth } from "../../../lib/auth/session.tsx";
import { Button } from "../../atoms/Button/Button.tsx";
import { SkipLink } from "../../atoms/SkipLink/SkipLink.tsx";
import "./AppLayout.css";

/**
 * The frame of the signed-in part of the app: a header with the name of the app, who is signed in
 * and a sign-out button, and the page below it. The header is skipped by the first link on the
 * screen, so a keyboard user does not have to pass it on every page.
 */
export function AppLayout({ children }: { readonly children: ReactNode }): ReactElement {
  const { state, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const name =
    state.status === "signed-in" ? (state.user.displayName ?? state.user.email) : undefined;

  const handleSignOut = async (): Promise<void> => {
    setSigningOut(true);
    try {
      // The screen is replaced by the login page as soon as the sign-out starts; if the server
      // cannot confirm it, the login page says so (see `signOutUnconfirmed`).
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <>
      <SkipLink targetId="main-content">Skip to main content</SkipLink>
      <header className="app-layout__header">
        <Link to="/app" className="app-layout__brand">
          Plotpal
        </Link>
        <div className="app-layout__account">
          {name === undefined ? null : (
            <p className="app-layout__who">
              Signed in as <strong>{name}</strong>
            </p>
          )}
          <Button variant="secondary" busy={signingOut} onClick={handleSignOut}>
            Sign out
          </Button>
        </div>
      </header>
      <main id="main-content" className="app-layout__main" tabIndex={-1}>
        {children}
      </main>
    </>
  );
}
