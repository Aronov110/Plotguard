import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import type { SessionResponse } from "../../../../lib/api/auth-api.ts";
import { AuthProvider } from "../../../../lib/auth/session.tsx";
import { deferred, session, setup } from "../../../../test-support/session-harness.ts";
import { signedInManager } from "../../../../test-support/signed-in-manager.ts";
import { RedirectIfSignedIn } from "../RedirectIfSignedIn.tsx";

function Where() {
  const location = useLocation();
  return (
    <p data-testid="where">
      {location.pathname}
      {location.search}
      {location.hash}
    </p>
  );
}

function renderAt(
  manager: Parameters<typeof AuthProvider>[0]["manager"],
  entry: string | { pathname: string; state?: unknown } = "/login",
) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider {...(manager === undefined ? {} : { manager })}>
        <Routes>
          <Route element={<RedirectIfSignedIn />}>
            <Route path="/login" element={<p>The login form</p>} />
          </Route>
          <Route path="*" element={<Where />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("RedirectIfSignedIn", () => {
  it("shows the form to a signed-out person", async () => {
    const { manager } = setup({ csrf: undefined });
    renderAt(manager);
    expect(await screen.findByText("The login form")).toBeInTheDocument();
  });

  it("does not show the form at all while it checks the session, so it cannot be used too early", async () => {
    const { manager, api } = setup();
    const pending = deferred<SessionResponse>();
    api.refresh.mockReturnValue(pending.promise);
    renderAt(manager);

    expect(screen.getByText("Checking your session…")).toBeInTheDocument();
    expect(screen.queryByText("The login form")).not.toBeInTheDocument();

    pending.resolve(session());
    expect(await screen.findByTestId("where")).toHaveTextContent("/app");
  });

  it("shows the form after the check finds no login", async () => {
    const { manager, api } = setup();
    const { ApiError } = await import("../../../../lib/api/problem.ts");
    api.refresh.mockRejectedValue(
      new ApiError({
        status: 401,
        code: undefined,
        detail: undefined,
        issues: [],
        retryAfterSeconds: undefined,
      }),
    );
    renderAt(manager);
    expect(await screen.findByText("The login form")).toBeInTheDocument();
  });

  describe("sends a signed-in person on", () => {
    it("to the app when nothing else was asked for", async () => {
      const { manager } = await signedInManager();
      renderAt(manager);
      expect(await screen.findByTestId("where")).toHaveTextContent("/app");
    });

    it.each([
      ["a page", "/app/projects/12", "/app/projects/12"],
      ["a page with a query and a fragment", "/app?tab=notes#top", "/app?tab=notes#top"],
    ])("to where they wanted to go: %s", async (_name, from, expected) => {
      const { manager } = await signedInManager();
      renderAt(manager, { pathname: "/login", state: { from } });
      expect(await screen.findByTestId("where")).toHaveTextContent(expected);
    });

    it.each([
      ["a protocol-relative address", "//evil.example"],
      ["an absolute address", "https://evil.example/app"],
      ["a backslash trick", "/\\evil.example"],
      ["a tab trick", "/\t/evil.example"],
      ["a newline trick", "/\n/evil.example"],
      ["a javascript address", "javascript:alert(1)"],
      ["the API's address space", "/auth/me"],
      ["an encoded API address", "/%61uth/me"],
      ["a number", 42],
      ["an object", { pathname: "/x" }],
      ["nothing", undefined],
    ])("to the app, ignoring a return address that is %s", async (_name, from) => {
      const { manager } = await signedInManager();
      renderAt(manager, { pathname: "/login", state: { from } });
      expect(await screen.findByTestId("where")).toHaveTextContent("/app");
      expect(screen.getByTestId("where")).not.toHaveTextContent("evil");
    });

    it("to the app when the state is not an object at all", async () => {
      const { manager } = await signedInManager();
      renderAt(manager, { pathname: "/login", state: "oops" });
      expect(await screen.findByTestId("where")).toHaveTextContent("/app");
    });
  });

  it("moves on as soon as the person signs in", async () => {
    const { manager, api } = setup({ csrf: undefined });
    renderAt(manager);
    expect(await screen.findByText("The login form")).toBeInTheDocument();

    api.login.mockResolvedValue(session());
    await manager.login({ email: "a@b.test", password: "x" });

    expect(await screen.findByTestId("where")).toHaveTextContent("/app");
  });
});
