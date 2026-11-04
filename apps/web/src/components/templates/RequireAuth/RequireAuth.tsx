import type { ReactElement } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../../../lib/auth/session.tsx";
import { CheckingSession } from "../../molecules/CheckingSession/CheckingSession.tsx";

/**
 * Guards the private screens: a signed-out person is sent to the login page, which sends them back
 * here afterwards. This is a convenience, not security: the data behind these screens is protected
 * by the API, which answers 401 to anyone without a valid token.
 */
export function RequireAuth(): ReactElement {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === "loading") return <CheckingSession />;
  if (state.status === "signed-out") {
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/login" replace state={{ from }} />;
  }
  return <Outlet />;
}
