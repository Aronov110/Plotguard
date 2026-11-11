import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "../../../../lib/auth/session.tsx";
import { signedInManager } from "../../../../test-support/signed-in-manager.ts";
import { AppLayout } from "../AppLayout.tsx";

async function renderLayout(wide?: boolean) {
  const context = await signedInManager();
  render(
    <MemoryRouter>
      <AuthProvider manager={context.manager}>
        {wide === undefined ? (
          <AppLayout>
            <p>Content</p>
          </AppLayout>
        ) : (
          <AppLayout wide={wide}>
            <p>Content</p>
          </AppLayout>
        )}
      </AuthProvider>
    </MemoryRouter>,
  );
  return screen.getByRole("main");
}

describe("AppLayout: the wide option", () => {
  it("has the normal width by default", async () => {
    const main = await renderLayout();
    expect(main).toHaveClass("app-layout__main");
    expect(main).not.toHaveClass("app-layout__main--wide");
  });

  it("has the normal width when wide is false", async () => {
    expect(await renderLayout(false)).not.toHaveClass("app-layout__main--wide");
  });

  it("has room for two panes when wide is true, and is still the main landmark that the skip link jumps to", async () => {
    const main = await renderLayout(true);
    expect(main).toHaveClass("app-layout__main", "app-layout__main--wide");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
    expect(main).toHaveTextContent("Content");
  });
});
