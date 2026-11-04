import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import type { SessionResponse } from "../../../../lib/api/auth-api.ts";
import { AuthProvider } from "../../../../lib/auth/session.tsx";
import { deferred, session, setup } from "../../../../test-support/session-harness.ts";
import { signedInManager } from "../../../../test-support/signed-in-manager.ts";
import { RequireAuth } from "../RequireAuth.tsx";

function Login() {
  const location = useLocation();
  return <p data-testid="login">login:{JSON.stringify(location.state)}</p>;
}

function renderRoutes(manager: Parameters<typeof AuthProvider>[0]["manager"], entry = "/app") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider {...(manager === undefined ? {} : { manager })}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<RequireAuth />}>
            <Route path="/app" element={<p>Private page</p>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("RequireAuth", () => {
  it("shows the private page to a signed-in person", async () => {
    const { manager } = await signedInManager();
    renderRoutes(manager);
    expect(screen.getByText("Private page")).toBeInTheDocument();
  });

  it("sends a signed-out person to the login page, remembering where they wanted to go", async () => {
    const { manager } = setup({ csrf: undefined });
    renderRoutes(manager);
    expect(await screen.findByTestId("login")).toHaveTextContent('login:{"from":"/app"}');
    expect(screen.queryByText("Private page")).not.toBeInTheDocument();
  });

  it("remembers the query and the fragment too", async () => {
    const { manager } = setup({ csrf: undefined });
    renderRoutes(manager, "/app?tab=notes#top");
    expect(await screen.findByTestId("login")).toHaveTextContent(
      'login:{"from":"/app?tab=notes#top"}',
    );
  });

  it("shows nothing private, only a notice, while it checks the session", async () => {
    const { manager, api } = setup();
    const pending = deferred<SessionResponse>();
    api.refresh.mockReturnValue(pending.promise);
    renderRoutes(manager);

    expect(screen.getByText("Checking your session…")).toBeInTheDocument();
    expect(screen.queryByText("Private page")).not.toBeInTheDocument();
    expect(screen.queryByTestId("login")).not.toBeInTheDocument();

    pending.resolve(session());
    expect(await screen.findByText("Private page")).toBeInTheDocument();
  });

  it("sends the person to the login page when the stored login turns out to be over", async () => {
    const { manager, api } = setup();
    api.refresh.mockRejectedValue(
      new (await import("../../../../lib/api/problem.ts")).ApiError({
        status: 401,
        code: undefined,
        detail: undefined,
        issues: [],
        retryAfterSeconds: undefined,
      }),
    );
    renderRoutes(manager);
    expect(await screen.findByTestId("login")).toBeInTheDocument();
  });

  it("leaves a private page as soon as the person signs out", async () => {
    const { manager } = await signedInManager();
    renderRoutes(manager);
    expect(screen.getByText("Private page")).toBeInTheDocument();

    await manager.signOut();

    expect(await screen.findByTestId("login")).toBeInTheDocument();
    expect(screen.queryByText("Private page")).not.toBeInTheDocument();
  });

  it("leaves a private page when another tab signs out", async () => {
    const { manager, broadcast } = await signedInManager();
    renderRoutes(manager);

    broadcast.emit();

    expect(await screen.findByTestId("login")).toBeInTheDocument();
  });
});
