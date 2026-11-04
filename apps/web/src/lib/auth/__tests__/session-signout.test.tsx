import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { setCookie } from "../../../test-support/cookies.ts";
import { server } from "../../../test-support/msw-server.ts";
import { authApi } from "../../api/auth-api.ts";
import { AuthProvider, useAuth } from "../session.tsx";
import { createSessionManager } from "../session-manager.ts";

const USER = { id: "user-1", email: "ada@example.com", displayName: null };
const SESSION = { user: USER, accessToken: "access-1", expiresIn: 900 };

function Probe() {
  const { state, signOutUnconfirmed, signOut, login, register } = useAuth();
  const [result, setResult] = useState("none");
  return (
    <div>
      <p data-testid="state">{state.status}</p>
      <p data-testid="unconfirmed">{String(signOutUnconfirmed)}</p>
      <p data-testid="result">{result}</p>
      <button
        type="button"
        onClick={() => {
          void signOut().then((confirmed) => {
            setResult(`confirmed:${confirmed}`);
          });
        }}
      >
        sign out
      </button>
      <button
        type="button"
        onClick={() => {
          // A rejected login is an expected outcome in some tests; the forms show it to the person.
          login({ email: "ada@example.com", password: "correct horse battery" }).catch(
            () => undefined,
          );
        }}
      >
        log in
      </button>
      <button
        type="button"
        onClick={() => {
          void register({ email: "ada@example.com", password: "correct horse battery" });
        }}
      >
        sign up
      </button>
    </div>
  );
}

async function signedInProbe() {
  setCookie("csrf_token", "code-1");
  server.use(http.post("/auth/refresh", () => HttpResponse.json(SESSION)));
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await screen.findByText("signed-in");
}

describe("sign-out that the server could not confirm", () => {
  it("is not reported before anyone signs out", async () => {
    await signedInProbe();
    expect(screen.getByTestId("unconfirmed")).toHaveTextContent("false");
  });

  it("is not reported when the server confirms", async () => {
    server.use(http.post("/auth/logout", () => new HttpResponse(null, { status: 204 })));
    await signedInProbe();

    fireEvent.click(screen.getByRole("button", { name: "sign out" }));

    expect(await screen.findByText("confirmed:true")).toBeInTheDocument();
    expect(screen.getByTestId("state")).toHaveTextContent("signed-out");
    expect(screen.getByTestId("unconfirmed")).toHaveTextContent("false");
  });

  it("is reported when the server cannot be reached, though the person is signed out here", async () => {
    server.use(http.post("/auth/logout", () => HttpResponse.error()));
    await signedInProbe();

    fireEvent.click(screen.getByRole("button", { name: "sign out" }));

    expect(await screen.findByText("confirmed:false")).toBeInTheDocument();
    expect(screen.getByTestId("state")).toHaveTextContent("signed-out");
    expect(screen.getByTestId("unconfirmed")).toHaveTextContent("true");
  });

  it("is reported when the server answers with an error", async () => {
    server.use(
      http.post("/auth/logout", () =>
        HttpResponse.json({ type: "urn:plotpal:problem:internal" }, { status: 500 }),
      ),
    );
    await signedInProbe();

    fireEvent.click(screen.getByRole("button", { name: "sign out" }));

    expect(await screen.findByText("confirmed:false")).toBeInTheDocument();
    expect(screen.getByTestId("unconfirmed")).toHaveTextContent("true");
  });

  it("goes away when a second sign-out is confirmed", async () => {
    let attempts = 0;
    server.use(
      http.post("/auth/logout", () => {
        attempts++;
        return attempts === 1 ? HttpResponse.error() : new HttpResponse(null, { status: 204 });
      }),
    );
    await signedInProbe();
    fireEvent.click(screen.getByRole("button", { name: "sign out" }));
    await screen.findByText("confirmed:false");

    fireEvent.click(screen.getByRole("button", { name: "sign out" }));

    expect(await screen.findByText("confirmed:true")).toBeInTheDocument();
    expect(screen.getByTestId("unconfirmed")).toHaveTextContent("false");
  });

  it("stays reported when the second sign-out fails too", async () => {
    server.use(http.post("/auth/logout", () => HttpResponse.error()));
    await signedInProbe();
    fireEvent.click(screen.getByRole("button", { name: "sign out" }));
    await screen.findByText("confirmed:false");

    fireEvent.click(screen.getByRole("button", { name: "sign out" }));

    await screen.findByText("confirmed:false");
    expect(screen.getByTestId("unconfirmed")).toHaveTextContent("true");
  });

  it("goes away when the person logs in again", async () => {
    server.use(
      http.post("/auth/logout", () => HttpResponse.error()),
      http.post("/auth/login", () => HttpResponse.json(SESSION)),
    );
    await signedInProbe();
    fireEvent.click(screen.getByRole("button", { name: "sign out" }));
    await screen.findByText("confirmed:false");

    fireEvent.click(screen.getByRole("button", { name: "log in" }));

    await screen.findByText("signed-in");
    expect(screen.getByTestId("unconfirmed")).toHaveTextContent("false");
  });

  it("goes away when the person signs up again", async () => {
    server.use(
      http.post("/auth/logout", () => HttpResponse.error()),
      http.post("/auth/register", () => HttpResponse.json(SESSION, { status: 201 })),
    );
    await signedInProbe();
    fireEvent.click(screen.getByRole("button", { name: "sign out" }));
    await screen.findByText("confirmed:false");

    fireEvent.click(screen.getByRole("button", { name: "sign up" }));

    await screen.findByText("signed-in");
    expect(screen.getByTestId("unconfirmed")).toHaveTextContent("false");
  });

  it("stays reported when a login attempt fails", async () => {
    server.use(
      http.post("/auth/logout", () => HttpResponse.error()),
      http.post("/auth/login", () =>
        HttpResponse.json({ type: "urn:plotpal:problem:unauthorized" }, { status: 401 }),
      ),
    );
    await signedInProbe();
    fireEvent.click(screen.getByRole("button", { name: "sign out" }));
    await screen.findByText("confirmed:false");

    fireEvent.click(screen.getByRole("button", { name: "log in" }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.getByTestId("unconfirmed")).toHaveTextContent("true");
  });

  it("does not warn while the server has not answered yet", async () => {
    let answer: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      answer = resolve;
    });
    server.use(
      http.post("/auth/logout", async () => {
        await gate;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await signedInProbe();

    fireEvent.click(screen.getByRole("button", { name: "sign out" }));

    // The page is signed out at once, but nobody has failed to confirm anything yet.
    await waitFor(() => {
      expect(screen.getByTestId("state")).toHaveTextContent("signed-out");
    });
    expect(screen.getByTestId("unconfirmed")).toHaveTextContent("false");
    answer();
    expect(await screen.findByText("confirmed:true")).toBeInTheDocument();
    expect(screen.getByTestId("unconfirmed")).toHaveTextContent("false");
  });

  describe("when the sign-out itself fails in an unexpected way", () => {
    async function brokenLogoutProbe() {
      setCookie("csrf_token", "code-1");
      server.use(http.post("/auth/refresh", () => HttpResponse.json(SESSION)));
      const manager = createSessionManager({
        api: { ...authApi, logout: () => Promise.reject(new Error("a bug in the logout call")) },
      });
      render(
        <AuthProvider manager={manager}>
          <Probe />
        </AuthProvider>,
      );
      await screen.findByText("signed-in");
    }

    it("still signs out here, warns the person, and lets nothing reject", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        await brokenLogoutProbe();

        fireEvent.click(screen.getByRole("button", { name: "sign out" }));

        // `Probe` does not catch: a rejected `signOut()` would fail this test as an unhandled rejection.
        expect(await screen.findByText("confirmed:false")).toBeInTheDocument();
        expect(screen.getByTestId("state")).toHaveTextContent("signed-out");
        expect(screen.getByTestId("unconfirmed")).toHaveTextContent("true");
        expect(logged).toHaveBeenCalledWith(
          expect.objectContaining({ message: "a bug in the logout call" }),
        );
      } finally {
        logged.mockRestore();
      }
    });

    it("shows the warning again after a retry that fails the same way", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        await brokenLogoutProbe();
        fireEvent.click(screen.getByRole("button", { name: "sign out" }));
        await screen.findByText("confirmed:false");

        fireEvent.click(screen.getByRole("button", { name: "sign out" }));

        await waitFor(() => {
          expect(logged).toHaveBeenCalledTimes(2);
        });
        expect(screen.getByTestId("unconfirmed")).toHaveTextContent("true");
      } finally {
        logged.mockRestore();
      }
    });
  });
});
