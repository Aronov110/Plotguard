import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "../../../../lib/auth/session.tsx";
import { expectNoPageA11yViolations } from "../../../../test-support/a11y.ts";
import { deferred, USER } from "../../../../test-support/session-harness.ts";
import { signedInManager } from "../../../../test-support/signed-in-manager.ts";
import { AppLayout } from "../AppLayout.tsx";

async function renderLayout(user = USER) {
  const context = await signedInManager(user);
  render(
    <MemoryRouter>
      <AuthProvider manager={context.manager}>
        <AppLayout>
          <h1>Your projects</h1>
          <p>Content</p>
        </AppLayout>
      </AuthProvider>
    </MemoryRouter>,
  );
  return context;
}

describe("AppLayout", () => {
  it("has a banner, a main landmark and shows the page inside main", async () => {
    await renderLayout();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("main")).toContainElement(screen.getByText("Content"));
  });

  it("links the name of the app to the signed-in home", async () => {
    await renderLayout();
    expect(screen.getByRole("link", { name: "Plotpal" })).toHaveAttribute("href", "/app");
  });

  describe("who is signed in", () => {
    it("shows the display name when there is one", async () => {
      await renderLayout({ ...USER, displayName: "Ada" });
      expect(screen.getByText("Signed in as")).toBeInTheDocument();
      expect(screen.getByText("Ada")).toBeInTheDocument();
    });

    it("shows the email when there is no display name", async () => {
      await renderLayout({ ...USER, displayName: null });
      expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    });

    it("shows the name as plain text, whatever it contains", async () => {
      await renderLayout({ ...USER, displayName: "<img src=x onerror=alert(1)>" });
      expect(document.querySelector("img")).toBeNull();
      expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    });
  });

  describe("skip link", () => {
    it("is the first thing the keyboard reaches", async () => {
      await renderLayout();
      await userEvent.setup().tab();
      expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveFocus();
    });

    it("moves the focus to the main content", async () => {
      const user = userEvent.setup();
      await renderLayout();
      await user.tab();
      await user.keyboard("{Enter}");
      expect(screen.getByRole("main")).toHaveFocus();
    });
  });

  describe("sign out", () => {
    it("signs out on the page and tells the server", async () => {
      const { api, manager } = await renderLayout();
      await userEvent.setup().click(screen.getByRole("button", { name: "Sign out" }));
      expect(api.logout).toHaveBeenCalledTimes(1);
      expect(manager.getState()).toEqual({ status: "signed-out" });
    });

    it("says it is busy and sends the request only once, however often it is pressed", async () => {
      const user = userEvent.setup();
      const { api } = await renderLayout();
      const pending = deferred<undefined>();
      api.logout.mockReturnValue(pending.promise);

      const button = screen.getByRole("button", { name: "Sign out" });
      await user.click(button);
      await user.click(button);
      await user.click(button);

      expect(api.logout).toHaveBeenCalledTimes(1);
      pending.resolve(undefined);
    });
  });

  it("has no accessibility violations as a page", async () => {
    await renderLayout();
    await expectNoPageA11yViolations();
  });

  describe("the colour theme", () => {
    it("offers a choice of system, light and dark in the header", async () => {
      await renderLayout();
      const header = screen.getByRole("banner");
      const group = within(header).getByRole("group", { name: "Colour theme" });
      expect(within(group).getAllByRole("radio")).toHaveLength(3);
    });

    it("puts the chosen theme on the page", async () => {
      await renderLayout();
      await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
      document.documentElement.removeAttribute("data-theme");
      window.localStorage.clear();
    });
  });

  it("shows the logo mark without adding to the name of the home link", async () => {
    await renderLayout();
    const link = screen.getByRole("link", { name: "Plotpal" });
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
