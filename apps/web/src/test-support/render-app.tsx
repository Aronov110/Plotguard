import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router";
import { RouteFocus } from "../components/templates/RouteFocus/RouteFocus.tsx";
import { AuthProvider } from "../lib/auth/session.tsx";
import { AppRoutes } from "../routes.tsx";
import { setCookie } from "./cookies.ts";
import { server } from "./msw-server.ts";

export const SIGNED_IN_USER = {
  id: "user-1",
  email: "ada@example.com",
  displayName: null as string | null,
};

export interface RenderAppOptions {
  /** Where the app opens. An object can carry history state, such as a saved return address. */
  readonly route?: string | { readonly pathname: string; readonly state?: unknown };
  /**
   * Starts with a login cookie that the (fake) API accepts, so the app restores a login at start.
   * Pass an object to change the user.
   */
  readonly signedIn?: boolean | { readonly displayName: string | null };
}

/** Renders the whole app (without the real browser) at a route, with the fake API in place. */
export function renderApp(options: RenderAppOptions = {}) {
  const { route = "/", signedIn = false } = options;

  if (signedIn !== false) {
    const user = {
      ...SIGNED_IN_USER,
      ...(typeof signedIn === "object" ? { displayName: signedIn.displayName } : {}),
    };
    setCookie("csrf_token", "code-1");
    server.use(
      http.post("/auth/refresh", () =>
        HttpResponse.json({ user, accessToken: "access-1", expiresIn: 900 }),
      ),
    );
  }

  const view = render(
    <AuthProvider>
      <MemoryRouter initialEntries={[route]}>
        <RouteFocus />
        <AppRoutes />
      </MemoryRouter>
    </AuthProvider>,
  );
  return { ...view, user: userEvent.setup() };
}
