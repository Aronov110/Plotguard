import { render } from "@testing-library/react";
import type { ButtonHTMLAttributes } from "react";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations, expectNoPageA11yViolations } from "../a11y.ts";

describe("expectNoA11yViolations", () => {
  it("passes for a properly labelled field", async () => {
    const { container } = render(
      <div>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" />
      </div>,
    );
    await expectNoA11yViolations(container);
  });

  it("fails for an input without a label, so the other tests can be trusted", async () => {
    const { container } = render(<input type="text" />);
    await expect(expectNoA11yViolations(container)).rejects.toThrow();
  });

  it("fails for a button without a name", async () => {
    const { container } = render(<button type="button" />);
    await expect(expectNoA11yViolations(container)).rejects.toThrow();
  });

  it("fails for an image without alternative text", async () => {
    // biome-ignore lint/a11y/useAltText: the missing alt text is exactly what this test checks
    const { container } = render(<img src="/x.png" />);
    await expect(expectNoA11yViolations(container)).rejects.toThrow();
  });

  it("fails for an invalid ARIA value", async () => {
    // TypeScript and Biome both refuse this value, which is why it goes through a cast.
    const invalid = {
      "aria-pressed": "maybe",
    } as unknown as ButtonHTMLAttributes<HTMLButtonElement>;
    const { container } = render(
      <button type="button" {...invalid}>
        Toggle
      </button>,
    );
    await expect(expectNoA11yViolations(container)).rejects.toThrow();
  });

  it("does not demand landmarks from a single component", async () => {
    const { container } = render(<p>Just a paragraph</p>);
    await expectNoA11yViolations(container);
  });
});

describe("expectNoPageA11yViolations", () => {
  it("passes for a page with one main landmark and one level-one heading", async () => {
    render(
      <main>
        <h1>Title</h1>
        <p>Text</p>
      </main>,
    );
    await expectNoPageA11yViolations();
  });

  it("fails when content sits outside any landmark", async () => {
    render(
      <>
        <main>
          <h1>Title</h1>
        </main>
        <p>Content outside any landmark</p>
      </>,
    );
    await expect(expectNoPageA11yViolations()).rejects.toThrow();
  });

  it("fails when there is no main landmark", async () => {
    render(<h1>Title</h1>);
    await expect(expectNoPageA11yViolations()).rejects.toThrow();
  });

  it("fails when there is no level-one heading", async () => {
    render(
      <main>
        <h2>Not the main heading</h2>
      </main>,
    );
    await expect(expectNoPageA11yViolations()).rejects.toThrow();
  });

  it("fails when there are two level-one headings", async () => {
    render(
      <main>
        <h1>One</h1>
        <h1>Two</h1>
      </main>,
    );
    await expect(expectNoPageA11yViolations()).rejects.toThrow();
  });

  it("fails when there are two main landmarks", async () => {
    render(
      <>
        <main>
          <h1>One</h1>
        </main>
        <main>
          <p>Two</p>
        </main>
      </>,
    );
    await expect(expectNoPageA11yViolations()).rejects.toThrow();
  });

  it("fails for a labelling problem inside the page", async () => {
    render(
      <main>
        <h1>Title</h1>
        <input type="text" />
      </main>,
    );
    await expect(expectNoPageA11yViolations()).rejects.toThrow();
  });
});
