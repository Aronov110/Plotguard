import type { ReactElement } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../../../lib/auth/session.tsx";
import { safeReturnPath } from "../../../lib/navigation/safe-return-path.ts";
import { CheckingSession } from "../../molecules/CheckingSession/CheckingSession.tsx";

/** Reads the address saved by `RequireAuth`, if the history state has one. */
function returnPathFrom(state: unknown): string | undefined {
  if (typeof state !== "object" || state === null || !("from" in state)) return undefined;
  return safeReturnPath(state.from);
}

/**
 * Guards the sign-up and login screens: someone who is already signed in has no business there, and
 * a person who has just signed in is moved on, to where they wanted to go or to the app. While the
 * app is still finding out whether a login exists, no form is shown, so none can be used too early.
 */
export function RedirectIfSignedIn(): ReactElement {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === "loading") return <CheckingSession />;
  if (state.status === "signed-in") {
    return <Navigate to={returnPathFrom(location.state) ?? "/app"} replace />;
  }
  return <Outlet />;
}
