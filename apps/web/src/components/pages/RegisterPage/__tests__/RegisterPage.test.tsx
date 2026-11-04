import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoPageA11yViolations } from "../../../../test-support/a11y.ts";
import { renderApp } from "../../../../test-support/render-app.tsx";

describe("RegisterPage", () => {
  it("is titled, in the page and in the tab", async () => {
    renderApp({ route: "/register" });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Create your account" }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Create your account – Plotpal");
  });

  it("has the sign-up form", async () => {
    renderApp({ route: "/register" });
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Display name (optional)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account" })).toBeInTheDocument();
  });

  it("links to the login page", async () => {
    renderApp({ route: "/register" });
    const link = await screen.findByRole("link", { name: "Log in" });
    expect(link).toHaveAttribute("href", "/login");
  });

  it("does not show the form to someone who is already signed in", async () => {
    renderApp({ route: "/register", signedIn: true });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Your projects" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("has no accessibility violations as a page", async () => {
    renderApp({ route: "/register" });
    await screen.findByLabelText("Email");
    await expectNoPageA11yViolations();
  });
});
