import type { ReactElement } from "react";
import { BrowserRouter } from "react-router";
import { RouteFocus } from "./components/templates/RouteFocus/RouteFocus.tsx";
import { AuthProvider } from "./lib/auth/session.tsx";
import { AppRoutes } from "./routes.tsx";

/** The whole app: the login state, the router, and the screens. */
export function App(): ReactElement {
  return (
    <AuthProvider>
      <BrowserRouter>
        <RouteFocus />
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
