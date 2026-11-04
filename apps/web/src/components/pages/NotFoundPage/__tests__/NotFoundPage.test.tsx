import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoPageA11yViolations } from "../../../../test-support/a11y.ts";
import { renderApp } from "../../../../test-support/render-app.tsx";

describe("NotFoundPage", () => {
  it.each(["/nowhere", "/app/unknown", "/login/extra", "/authors", "/a/b/c"])(
    "is shown for %s",
    async (route) => {
      renderApp({ route, signedIn: route.startsWith("/app") });
      expect(
        await screen.findByRole("heading", { level: 1, name: "Page not found" }),
      ).toBeInTheDocument();
    },
  );

  it("is titled in the tab", async () => {
    renderApp({ route: "/nowhere" });
    await screen.findByRole("heading", { level: 1, name: "Page not found" });
    expect(document.title).toBe("Page not found – Plotpal");
  });

  it("links back to the home page", async () => {
    renderApp({ route: "/nowhere" });
    expect(await screen.findByRole("link", { name: "Go to the home page" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("does not echo the address that was asked for", async () => {
    renderApp({ route: "/%3Cscript%3Ealert(1)%3C/script%3E" });
    await screen.findByRole("heading", { level: 1, name: "Page not found" });
    expect(document.body).not.toHaveTextContent("alert(1)");
  });

  it("has no accessibility violations as a page", async () => {
    renderApp({ route: "/nowhere" });
    await screen.findByRole("heading", { level: 1, name: "Page not found" });
    await expectNoPageA11yViolations();
  });
});
