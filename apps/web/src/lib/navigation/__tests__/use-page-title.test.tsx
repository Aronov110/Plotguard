import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePageTitle } from "../use-page-title.ts";

function Page({ title }: { title?: string }) {
  usePageTitle(title);
  return null;
}

describe("usePageTitle", () => {
  it("puts the name of the app after the title of the page", () => {
    render(<Page title="Log in" />);
    expect(document.title).toBe("Log in – Plotpal");
  });

  it("is just the name of the app without a title", () => {
    render(<Page />);
    expect(document.title).toBe("Plotpal");
  });

  it("follows the title when it changes", () => {
    const { rerender } = render(<Page title="Log in" />);
    rerender(<Page title="Create your account" />);
    expect(document.title).toBe("Create your account – Plotpal");
  });

  it("is replaced by the next page's title", () => {
    const first = render(<Page title="One" />);
    first.unmount();
    render(<Page title="Two" />);
    expect(document.title).toBe("Two – Plotpal");
  });

  it("keeps markup in a title as plain text", () => {
    render(<Page title="<b>x</b>" />);
    expect(document.title).toBe("<b>x</b> – Plotpal");
    expect(document.head.querySelector("b")).toBeNull();
  });
});
