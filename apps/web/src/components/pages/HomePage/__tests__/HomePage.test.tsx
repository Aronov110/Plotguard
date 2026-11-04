import { screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { expectNoPageA11yViolations } from "../../../../test-support/a11y.ts";
import { setCookie } from "../../../../test-support/cookies.ts";
import { server } from "../../../../test-support/msw-server.ts";
import { renderApp } from "../../../../test-support/render-app.tsx";
import { deferred } from "../../../../test-support/session-harness.ts";

describe("HomePage", () => {
  it("renders a main landmark", async () => {
    renderApp();
    expect(await screen.findByRole("main")).toBeInTheDocument();
  });

  it("renders a single level-one heading with the app name", async () => {
    renderApp();
    await screen.findByRole("link", { name: "Log in" });
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Plotpal");
  });

  it("renders the tagline", async () => {
    renderApp();
    expect(await screen.findByText(/catch what you missed/i)).toBeInTheDocument();
  });

  it("sets the title of the tab to the name of the app", async () => {
    renderApp();
    await screen.findByRole("main");
    expect(document.title).toBe("Plotpal");
  });

  describe("for someone who is signed out", () => {
    it("offers to create an account or to log in", async () => {
      renderApp();
      expect(await screen.findByRole("link", { name: "Create account" })).toHaveAttribute(
        "href",
        "/register",
      );
      expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
      expect(screen.queryByRole("link", { name: "Go to your projects" })).not.toBeInTheDocument();
    });

    it("has no accessibility violations as a page", async () => {
      renderApp();
      await screen.findByRole("link", { name: "Log in" });
      await expectNoPageA11yViolations();
    });
  });

  describe("for someone who is signed in", () => {
    it("offers to go to the projects, and not to sign up", async () => {
      renderApp({ signedIn: true });
      expect(await screen.findByRole("link", { name: "Go to your projects" })).toHaveAttribute(
        "href",
        "/app",
      );
      expect(screen.queryByRole("link", { name: "Create account" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Log in" })).not.toBeInTheDocument();
    });

    it("has no accessibility violations as a page", async () => {
      renderApp({ signedIn: true });
      await screen.findByRole("link", { name: "Go to your projects" });
      await expectNoPageA11yViolations();
    });
  });

  describe("while the app checks for a login", () => {
    it("offers no action yet, so nothing flickers from one to the other", async () => {
      // The fake server holds its answer until the checks of the waiting state are done.
      const gate = deferred<undefined>();
      setCookie("csrf_token", "code-1");
      server.use(
        http.post("/auth/refresh", async () => {
          await gate.promise;
          return HttpResponse.json({
            user: { id: "u", email: "a@b.test", displayName: null },
            accessToken: "t",
            expiresIn: 900,
          });
        }),
      );
      renderApp();
      expect(screen.getByRole("heading", { level: 1, name: "Plotpal" })).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      gate.resolve(undefined);
      expect(await screen.findByRole("link", { name: "Go to your projects" })).toBeInTheDocument();
    });
  });
});
