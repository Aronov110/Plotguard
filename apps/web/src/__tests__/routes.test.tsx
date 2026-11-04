import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { getAccessToken } from "../lib/auth/token-store.ts";
import { expectNoPageA11yViolations } from "../test-support/a11y.ts";
import { setCookie } from "../test-support/cookies.ts";
import { server } from "../test-support/msw-server.ts";
import { renderApp } from "../test-support/render-app.tsx";
import { deferred } from "../test-support/session-harness.ts";

const PASSWORD = "correct horse battery";

function session(displayName: string | null = null) {
  return {
    user: { id: "user-1", email: "ada@example.com", displayName },
    accessToken: "access-1",
    expiresIn: 900,
  };
}

function loginWorks() {
  const calls: unknown[] = [];
  server.use(
    http.post("/auth/login", async ({ request }) => {
      calls.push(await request.json());
      // The API sets these cookies; the fake one has to do the same for the app to find them later.
      setCookie("csrf_token", "code-1");
      return HttpResponse.json(session());
    }),
  );
  return calls;
}

async function logIn(user: ReturnType<typeof renderApp>["user"]) {
  await user.type(await screen.findByLabelText("Email"), "ada@example.com");
  await user.click(screen.getByLabelText("Password"));
  await user.paste(PASSWORD);
  await user.click(screen.getByRole("button", { name: "Log in" }));
}

describe("the app", () => {
  describe("opening it", () => {
    it("shows the landing page without any request when nobody has logged in", async () => {
      renderApp();
      expect(await screen.findByRole("link", { name: "Log in" })).toBeInTheDocument();
      expect(getAccessToken()).toBeUndefined();
    });

    it("does not steal the focus from the browser when it first opens", async () => {
      renderApp({ route: "/login" });
      await screen.findByLabelText("Email");
      expect(document.body).toHaveFocus();
    });

    it("restores a login from the cookies and goes straight to the private page", async () => {
      // The fake server holds its answer until the checks of the waiting state are done.
      const gate = deferred<undefined>();
      server.use(
        http.post("/auth/refresh", async () => {
          await gate.promise;
          return HttpResponse.json(session());
        }),
      );
      setCookie("csrf_token", "code-1");
      renderApp({ route: "/app" });

      expect(screen.getByText("Checking your session…")).toBeInTheDocument();
      expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
      gate.resolve(undefined);
      expect(
        await screen.findByRole("heading", { level: 1, name: "Your projects" }),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    });

    it("shows the login page when the stored login is over", async () => {
      setCookie("csrf_token", "code-1");
      server.use(
        http.post("/auth/refresh", () =>
          HttpResponse.json({ type: "urn:plotpal:problem:unauthorized" }, { status: 401 }),
        ),
      );
      renderApp({ route: "/app" });
      expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
    });
  });

  describe("moving between screens", () => {
    it("moves the focus to the new screen's heading and sets the tab's title", async () => {
      const { user } = renderApp();
      await user.click(await screen.findByRole("link", { name: "Log in" }));

      const heading = await screen.findByRole("heading", { level: 1, name: "Log in" });
      expect(heading).toHaveFocus();
      expect(document.title).toBe("Log in – Plotpal");
    });

    it("goes from the login page to the sign-up page and back", async () => {
      const { user } = renderApp({ route: "/login" });
      await user.click(await screen.findByRole("link", { name: "Create one" }));
      expect(
        await screen.findByRole("heading", { level: 1, name: "Create your account" }),
      ).toHaveFocus();
      await user.click(screen.getByRole("link", { name: "Log in" }));
      expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toHaveFocus();
    });
  });

  describe("logging in", () => {
    it("goes to the private page", async () => {
      const calls = loginWorks();
      const { user } = renderApp({ route: "/login" });
      await logIn(user);

      expect(
        await screen.findByRole("heading", { level: 1, name: "Your projects" }),
      ).toBeInTheDocument();
      expect(calls).toEqual([{ email: "ada@example.com", password: PASSWORD }]);
      expect(getAccessToken()).toBe("access-1");
    });

    it("goes back to the private page that sent the person to the login", async () => {
      loginWorks();
      const { user } = renderApp({ route: "/app" });
      expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();

      await logIn(user);

      expect(
        await screen.findByRole("heading", { level: 1, name: "Your projects" }),
      ).toBeInTheDocument();
    });

    it.each([
      ["a protocol-relative address", "//evil.example"],
      ["an absolute address", "https://evil.example/app"],
      ["a backslash trick", "/\\evil.example"],
      ["the API's address space", "/auth/me"],
    ])("goes to the app, not to %s, when the saved return address is bad", async (_name, from) => {
      loginWorks();
      const { user } = renderApp({ route: { pathname: "/login", state: { from } } });
      await logIn(user);
      expect(
        await screen.findByRole("heading", { level: 1, name: "Your projects" }),
      ).toBeInTheDocument();
    });

    it("goes to the private page after signing up instead", async () => {
      server.use(
        http.post("/auth/register", () => {
          setCookie("csrf_token", "code-1");
          return HttpResponse.json(session("Ada"), { status: 201 });
        }),
      );
      const { user } = renderApp({ route: "/register" });
      await user.type(await screen.findByLabelText("Email"), "ada@example.com");
      await user.click(screen.getByLabelText("Password"));
      await user.paste(PASSWORD);
      await user.type(screen.getByLabelText(/Display name/), "Ada");
      await user.click(screen.getByRole("button", { name: "Create account" }));

      expect(
        await screen.findByRole("heading", { level: 1, name: "Your projects" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Ada")).toBeInTheDocument();
    });
  });

  describe("signing out", () => {
    it("returns to the login page, tells the server with the CSRF code and forgets the token", async () => {
      const logouts: (string | null)[] = [];
      server.use(
        http.post("/auth/logout", ({ request }) => {
          logouts.push(request.headers.get("x-csrf-token"));
          return new HttpResponse(null, { status: 204 });
        }),
      );
      const { user } = renderApp({ route: "/app", signedIn: true });
      await user.click(await screen.findByRole("button", { name: "Sign out" }));

      expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
      await waitFor(() => expect(logouts).toEqual(["code-1"]));
      expect(getAccessToken()).toBeUndefined();
      expect(screen.queryByText(/shared computer/i)).not.toBeInTheDocument();
    });

    it("does not leave the private page readable behind the login page", async () => {
      server.use(http.post("/auth/logout", () => new HttpResponse(null, { status: 204 })));
      const { user } = renderApp({ route: "/app", signedIn: true });
      await user.click(await screen.findByRole("button", { name: "Sign out" }));
      await screen.findByRole("heading", { level: 1, name: "Log in" });
      expect(screen.queryByText(/Your projects will appear here/)).not.toBeInTheDocument();
    });

    it("warns on the login page when the server could not be told, and can try again", async () => {
      server.use(http.post("/auth/logout", () => HttpResponse.error()));
      const { user } = renderApp({ route: "/app", signedIn: true });
      await user.click(await screen.findByRole("button", { name: "Sign out" }));

      expect(await screen.findByText(/shared computer/i)).toBeInTheDocument();

      server.use(http.post("/auth/logout", () => new HttpResponse(null, { status: 204 })));
      await user.click(screen.getByRole("button", { name: "Try signing out again" }));
      await waitFor(() => expect(screen.queryByText(/shared computer/i)).not.toBeInTheDocument());
    });

    it("removes the warning once the person logs in again", async () => {
      server.use(http.post("/auth/logout", () => HttpResponse.error()));
      loginWorks();
      const { user } = renderApp({ route: "/app", signedIn: true });
      await user.click(await screen.findByRole("button", { name: "Sign out" }));
      await screen.findByText(/shared computer/i);

      await logIn(user);

      await screen.findByRole("heading", { level: 1, name: "Your projects" });
      expect(screen.queryByText(/shared computer/i)).not.toBeInTheDocument();
    });
  });

  describe("people who are already signed in", () => {
    it.each(["/login", "/register"])("are moved on from %s to the private page", async (route) => {
      renderApp({ route, signedIn: true });
      expect(
        await screen.findByRole("heading", { level: 1, name: "Your projects" }),
      ).toBeInTheDocument();
    });
  });

  describe("addresses that do not exist", () => {
    it("show the not-found page with a way home", async () => {
      const { user } = renderApp({ route: "/nowhere" });
      expect(
        await screen.findByRole("heading", { level: 1, name: "Page not found" }),
      ).toBeInTheDocument();
      await user.click(screen.getByRole("link", { name: "Go to the home page" }));
      expect(await screen.findByRole("heading", { level: 1, name: "Plotpal" })).toHaveFocus();
    });
  });

  describe("accessibility of the whole app", () => {
    it.each([
      ["the landing page", "/", false],
      ["the login page", "/login", false],
      ["the sign-up page", "/register", false],
      ["the private page", "/app", true],
      ["the not-found page", "/nowhere", false],
    ])("%s has no violations", async (_name, route, signedIn) => {
      renderApp({ route, signedIn });
      await screen.findByRole("heading", { level: 1 });
      await waitFor(() =>
        expect(screen.queryByText("Checking your session…")).not.toBeInTheDocument(),
      );
      await expectNoPageA11yViolations();
    });

    it("the login page has no violations while it shows problems", async () => {
      const { user } = renderApp({ route: "/login" });
      await user.click(await screen.findByRole("button", { name: "Log in" }));
      const summary = await screen.findByRole("alert");
      expect(within(summary).getAllByRole("link")).toHaveLength(2);
      await expectNoPageA11yViolations();
    });
  });
});
