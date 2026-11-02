import { act, fireEvent, render, screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { StrictMode, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { setCookie } from "../../../test-support/cookies.ts";
import { server } from "../../../test-support/msw-server.ts";
import { ApiError } from "../../api/problem.ts";
import { AuthProvider, useAuth } from "../session.tsx";
import { createSessionManager } from "../session-manager.ts";
import { getAccessToken } from "../token-store.ts";

const USER = { id: "user-1", email: "ada@example.com", displayName: null };
const SESSION = { user: USER, accessToken: "access-1", expiresIn: 900 };

function Probe() {
  const { state, login, register, signOut } = useAuth();
  const [error, setError] = useState("");
  const report = (caught: unknown) => {
    setError(caught instanceof ApiError ? `error:${caught.status}` : "error:other");
  };
  return (
    <div>
      <p data-testid="state">
        {state.status === "signed-in" ? `signed-in:${state.user.email}` : state.status}
      </p>
      <p data-testid="error">{error}</p>
      <button
        type="button"
        onClick={() => {
          login({ email: "ada@example.com", password: "correct horse battery" }).catch(report);
        }}
      >
        log in
      </button>
      <button
        type="button"
        onClick={() => {
          register({ email: "ada@example.com", password: "correct horse battery" }).catch(report);
        }}
      >
        sign up
      </button>
      <button
        type="button"
        onClick={() => {
          void signOut();
        }}
      >
        log out
      </button>
    </div>
  );
}

function renderWithProvider(ui = <Probe />) {
  return render(<AuthProvider>{ui}</AuthProvider>);
}

function countRefreshes(reply: () => Response = () => HttpResponse.json(SESSION)) {
  const counter = { calls: 0 };
  server.use(
    http.post("/auth/refresh", () => {
      counter.calls++;
      return reply();
    }),
  );
  return counter;
}

describe("useAuth", () => {
  it("explains the mistake when used outside an AuthProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/AuthProvider/);
    spy.mockRestore();
  });
});

describe("AuthProvider: starting", () => {
  it("is signed out at once, with no request, when there is no CSRF cookie", async () => {
    const refreshes = countRefreshes();
    renderWithProvider();
    expect(await screen.findByText("signed-out")).toBeInTheDocument();
    expect(refreshes.calls).toBe(0);
    expect(getAccessToken()).toBeUndefined();
  });

  it("restores the login from the cookies", async () => {
    setCookie("csrf_token", "code-1");
    countRefreshes();
    renderWithProvider();
    expect(screen.getByTestId("state")).toHaveTextContent("loading");
    expect(await screen.findByText("signed-in:ada@example.com")).toBeInTheDocument();
    expect(getAccessToken()).toBe("access-1");
  });

  it("shows signed out when the stored login is no longer valid", async () => {
    setCookie("csrf_token", "code-1");
    server.use(
      http.post("/auth/refresh", () =>
        HttpResponse.json({ type: "urn:plotpal:problem:unauthorized" }, { status: 401 }),
      ),
    );
    renderWithProvider();
    expect(await screen.findByText("signed-out")).toBeInTheDocument();
    expect(getAccessToken()).toBeUndefined();
  });

  it("restores only once under React's StrictMode, which runs effects twice", async () => {
    setCookie("csrf_token", "code-1");
    const refreshes = countRefreshes();
    render(
      <StrictMode>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </StrictMode>,
    );
    expect(await screen.findByText("signed-in:ada@example.com")).toBeInTheDocument();
    expect(refreshes.calls).toBe(1);
  });
});

describe("AuthProvider: signing in and out", () => {
  it("logs in through the hook", async () => {
    server.use(http.post("/auth/login", () => HttpResponse.json(SESSION)));
    renderWithProvider();
    await screen.findByText("signed-out");

    fireEvent.click(screen.getByRole("button", { name: "log in" }));

    expect(await screen.findByText("signed-in:ada@example.com")).toBeInTheDocument();
    expect(getAccessToken()).toBe("access-1");
  });

  it("hands a failed login to the caller and stays signed out", async () => {
    server.use(
      http.post("/auth/login", () =>
        HttpResponse.json({ type: "urn:plotpal:problem:unauthorized" }, { status: 401 }),
      ),
    );
    renderWithProvider();
    await screen.findByText("signed-out");

    fireEvent.click(screen.getByRole("button", { name: "log in" }));

    expect(await screen.findByText("error:401")).toBeInTheDocument();
    expect(screen.getByTestId("state")).toHaveTextContent("signed-out");
  });

  it("registers through the hook", async () => {
    server.use(http.post("/auth/register", () => HttpResponse.json(SESSION, { status: 201 })));
    renderWithProvider();
    await screen.findByText("signed-out");

    fireEvent.click(screen.getByRole("button", { name: "sign up" }));

    expect(await screen.findByText("signed-in:ada@example.com")).toBeInTheDocument();
  });

  it("hands a duplicate email to the caller", async () => {
    server.use(
      http.post("/auth/register", () =>
        HttpResponse.json({ type: "urn:plotpal:problem:conflict" }, { status: 409 }),
      ),
    );
    renderWithProvider();
    await screen.findByText("signed-out");

    fireEvent.click(screen.getByRole("button", { name: "sign up" }));

    expect(await screen.findByText("error:409")).toBeInTheDocument();
  });

  it("signs out through the hook and forgets the token", async () => {
    setCookie("csrf_token", "code-1");
    countRefreshes();
    const logouts = { calls: 0 };
    server.use(
      http.post("/auth/logout", ({ request }) => {
        logouts.calls++;
        expect(request.headers.get("x-csrf-token")).toBe("code-1");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWithProvider();
    await screen.findByText("signed-in:ada@example.com");

    fireEvent.click(screen.getByRole("button", { name: "log out" }));

    expect(await screen.findByText("signed-out")).toBeInTheDocument();
    await vi.waitFor(() => expect(logouts.calls).toBe(1));
    expect(getAccessToken()).toBeUndefined();
  });
});

describe("AuthProvider: lifetime", () => {
  it("stops the refresh timer when it unmounts", async () => {
    setCookie("csrf_token", "code-1");
    countRefreshes();
    const manager = createSessionManager();
    const stop = vi.spyOn(manager, "stop");
    const view = render(
      <AuthProvider manager={manager}>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("signed-in:ada@example.com");
    expect(stop).not.toHaveBeenCalled();

    view.unmount();

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("uses the manager it is given", async () => {
    const manager = createSessionManager({ readCsrf: () => undefined });
    await act(async () => {
      render(
        <AuthProvider manager={manager}>
          <Probe />
        </AuthProvider>,
      );
    });
    expect(manager.getState()).toEqual({ status: "signed-out" });
    expect(screen.getByTestId("state")).toHaveTextContent("signed-out");
  });
});
