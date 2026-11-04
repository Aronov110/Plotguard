import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoPageA11yViolations } from "../../../../test-support/a11y.ts";
import { renderApp } from "../../../../test-support/render-app.tsx";

describe("LoginPage", () => {
  it("is titled Log in, in the page and in the tab", async () => {
    renderApp({ route: "/login" });
    expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
    expect(document.title).toBe("Log in – Plotpal");
  });

  it("has the login form", async () => {
    renderApp({ route: "/login" });
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
  });

  it("links to the sign-up page", async () => {
    renderApp({ route: "/login" });
    expect(await screen.findByRole("link", { name: "Create one" })).toHaveAttribute(
      "href",
      "/register",
    );
  });

  it("shows no sign-out notice when nothing went wrong", async () => {
    renderApp({ route: "/login" });
    await screen.findByLabelText("Email");
    expect(screen.queryByText(/shared computer/i)).not.toBeInTheDocument();
  });

  it("does not show the form to someone who is already signed in", async () => {
    renderApp({ route: "/login", signedIn: true });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Your projects" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("has no accessibility violations as a page", async () => {
    renderApp({ route: "/login" });
    await screen.findByLabelText("Email");
    await expectNoPageA11yViolations();
  });
});
