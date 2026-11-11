import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SaveStatus as SaveState } from "../../../../lib/documents/document-saver.ts";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { SaveStatus } from "../SaveStatus.tsx";

describe("SaveStatus: the calm states", () => {
  it.each([
    [{ kind: "saved" }, "Saved"],
    [{ kind: "unsaved" }, "Unsaved changes"],
    [{ kind: "saving" }, "Saving…"],
  ] as const)("says %j in words, without announcing it", (status, words) => {
    render(<SaveStatus status={status} />);
    expect(screen.getByText(words)).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("SaveStatus: problems", () => {
  it("announces a problem that will be retried, with its words", () => {
    render(<SaveStatus status={{ kind: "retrying", message: "Can't reach the server." }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Not saved. Can't reach the server.");
  });

  it("announces text that cannot be saved, with the reason", () => {
    render(
      <SaveStatus
        status={{ kind: "invalid", message: "The text contains an invalid character." }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Not saved. The text contains an invalid character.",
    );
  });

  it("announces a document that is gone, and tells the writer to copy the text", () => {
    render(<SaveStatus status={{ kind: "gone" }} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("does not exist any more");
    expect(alert).toHaveTextContent("copy it before you leave");
  });

  it("says Not saved for a conflict, and leaves the explaining to the notice", () => {
    render(<SaveStatus status={{ kind: "conflict" }} />);
    expect(screen.getByText("Not saved")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the message as plain text, whatever it contains", () => {
    render(<SaveStatus status={{ kind: "retrying", message: "<b>x</b><script>y()</script>" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("<b>x</b><script>y()</script>");
    expect(document.querySelector("b, script")).toBeNull();
  });
});

describe("SaveStatus: accessibility", () => {
  it("has no violations in any state", async () => {
    const states: SaveState[] = [
      { kind: "saved" },
      { kind: "unsaved" },
      { kind: "saving" },
      { kind: "conflict" },
      { kind: "gone" },
      { kind: "invalid", message: "A reason." },
      { kind: "retrying", message: "A reason." },
    ];
    const { container } = render(
      <div>
        {states.map((status) => (
          <SaveStatus key={status.kind} status={status} />
        ))}
      </div>,
    );
    await expectNoA11yViolations(container);
  });
});
