import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { AuthProvider, useAuth } from "../../../../lib/auth/session.tsx";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { setCookie } from "../../../../test-support/cookies.ts";
import { server } from "../../../../test-support/msw-server.ts";
import { deferred } from "../../../../test-support/session-harness.ts";
import { SignOutNotice } from "../SignOutNotice.tsx";

const SESSION = {
  user: { id: "user-1", email: "ada@example.com", displayName: null },
  accessToken: "access-1",
  expiresIn: 900,
};

function SignOutButton() {
  const { signOut, state } = useAuth();
  return (
    <>
      <p data-testid="state">{state.status}</p>
      <button
        type="button"
        onClick={() => {
          void signOut();
        }}
      >
        sign out
      </button>
    </>
  );
}

async function signedIn() {
  setCookie("csrf_token", "code-1");
  server.use(http.post("/auth/refresh", () => HttpResponse.json(SESSION)));
  const view = render(
    <MemoryRouter>
      <AuthProvider>
        <SignOutNotice />
        <SignOutButton />
      </AuthProvider>
    </MemoryRouter>,
  );
  await screen.findByText("signed-in");
  return view;
}

describe("SignOutNotice", () => {
  it("shows nothing when nothing is wrong", async () => {
    await signedIn();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows nothing after a sign-out the server confirmed", async () => {
    server.use(http.post("/auth/logout", () => new HttpResponse(null, { status: 204 })));
    await signedIn();
    fireEvent.click(screen.getByRole("button", { name: "sign out" }));
    await screen.findByText("signed-out");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  describe("after a sign-out the server could not confirm", () => {
    async function unconfirmed() {
      server.use(http.post("/auth/logout", () => HttpResponse.error()));
      const view = await signedIn();
      fireEvent.click(screen.getByRole("button", { name: "sign out" }));
      await screen.findByRole("status");
      return view;
    }

    it("says so, and what to do on a shared computer", async () => {
      await unconfirmed();
      const notice = screen.getByRole("status");
      expect(notice).toHaveTextContent("You are signed out here");
      expect(notice).toHaveTextContent("could not confirm it with the server");
      expect(notice).toHaveTextContent("shared computer");
      expect(notice).toHaveTextContent("close the browser");
    });

    it("offers to try again", async () => {
      await unconfirmed();
      expect(screen.getByRole("button", { name: "Try signing out again" })).toBeInTheDocument();
    });

    it("goes away when the second try works", async () => {
      await unconfirmed();
      server.use(http.post("/auth/logout", () => new HttpResponse(null, { status: 204 })));
      await userEvent.setup().click(screen.getByRole("button", { name: "Try signing out again" }));
      await waitUntilNoticeIsGone();
    });

    it("stays when the second try fails too, and can be tried again", async () => {
      await unconfirmed();
      const user = userEvent.setup();
      const button = screen.getByRole("button", { name: "Try signing out again" });
      await user.click(button);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Try signing out again" })).not.toHaveAttribute(
        "aria-busy",
      );
    });

    it("sends the second try only once, however often it is pressed", async () => {
      await unconfirmed();
      let attempts = 0;
      // The fake server holds its answer until the test opens the gate, so both presses happen
      // while the first request is still running, at any speed.
      const gate = deferred<undefined>();
      server.use(
        http.post("/auth/logout", async () => {
          attempts++;
          await gate.promise;
          return new HttpResponse(null, { status: 204 });
        }),
      );
      const user = userEvent.setup();
      const button = screen.getByRole("button", { name: "Try signing out again" });
      await user.click(button);
      await user.click(button);
      expect(button).toHaveAttribute("aria-busy", "true");
      gate.resolve(undefined);
      await waitUntilNoticeIsGone();
      expect(attempts).toBe(1);
    });

    it("has no accessibility violations", async () => {
      const { container } = await unconfirmed();
      await expectNoA11yViolations(container);
    });
  });
});

async function waitUntilNoticeIsGone() {
  await waitFor(() => {
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
}
