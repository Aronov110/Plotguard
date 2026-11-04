import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoPageA11yViolations } from "../../../../test-support/a11y.ts";
import { renderApp } from "../../../../test-support/render-app.tsx";

describe("AppHomePage", () => {
  it("is titled Your projects, in the page and in the tab", async () => {
    renderApp({ route: "/app", signedIn: true });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Your projects" }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Your projects – Plotpal");
  });

  it("says that the projects are still to come", async () => {
    renderApp({ route: "/app", signedIn: true });
    expect(await screen.findByText(/Your projects will appear here/)).toBeInTheDocument();
  });

  it("shows who is signed in, by display name when there is one", async () => {
    renderApp({ route: "/app", signedIn: { displayName: "Ada" } });
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Signed in as")).toBeInTheDocument();
  });

  it("shows who is signed in, by email when there is no display name", async () => {
    renderApp({ route: "/app", signedIn: true });
    expect(await screen.findByText("ada@example.com")).toBeInTheDocument();
  });

  it("has a sign-out button", async () => {
    renderApp({ route: "/app", signedIn: true });
    expect(await screen.findByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("is not shown to someone who is signed out", async () => {
    renderApp({ route: "/app" });
    expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
    expect(screen.queryByText(/Your projects will appear here/)).not.toBeInTheDocument();
  });

  it("has no accessibility violations as a page", async () => {
    renderApp({ route: "/app", signedIn: { displayName: "Ada" } });
    await screen.findByRole("heading", { level: 1, name: "Your projects" });
    await expectNoPageA11yViolations();
  });
});
