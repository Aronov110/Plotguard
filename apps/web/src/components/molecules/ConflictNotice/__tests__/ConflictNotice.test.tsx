import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { ConflictNotice, type ConflictNoticeProps } from "../ConflictNotice.tsx";

function renderNotice(props: Partial<ConflictNoticeProps> = {}) {
  const onKeepMine = vi.fn();
  const onLoadNewer = vi.fn();
  const view = render(
    <ConflictNotice
      busy={false}
      error={undefined}
      onKeepMine={onKeepMine}
      onLoadNewer={onLoadNewer}
      {...props}
    />,
  );
  return { ...view, onKeepMine, onLoadNewer, user: userEvent.setup() };
}

describe("ConflictNotice", () => {
  it("is announced, and says what happened and that nothing was lost", () => {
    renderNotice();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("This text was changed somewhere else.");
    expect(alert).toHaveTextContent(
      "Your text is still in the box and nothing has been overwritten",
    );
  });

  it("has two buttons whose words say exactly what they do", () => {
    renderNotice();
    expect(screen.getByRole("button", { name: "Save my text over theirs" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Load the newer text (discard mine)" }),
    ).toBeVisible();
  });

  it("calls the right action for each button", async () => {
    const { user, onKeepMine, onLoadNewer } = renderNotice();
    await user.click(screen.getByRole("button", { name: "Save my text over theirs" }));
    expect(onKeepMine).toHaveBeenCalledTimes(1);
    expect(onLoadNewer).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Load the newer text (discard mine)" }));
    expect(onLoadNewer).toHaveBeenCalledTimes(1);
  });

  it("shows both buttons as busy, and ignores presses, while one action runs", async () => {
    const { user, onKeepMine, onLoadNewer } = renderNotice({ busy: true });
    const keep = screen.getByRole("button", { name: "Save my text over theirs" });
    const load = screen.getByRole("button", { name: "Load the newer text (discard mine)" });
    expect(keep).toHaveAttribute("aria-busy", "true");
    expect(load).toHaveAttribute("aria-busy", "true");
    await user.click(keep);
    await user.click(load);
    expect(onKeepMine).not.toHaveBeenCalled();
    expect(onLoadNewer).not.toHaveBeenCalled();
  });

  it("shows why an action failed, as plain text", () => {
    renderNotice({ error: "<b>Could not load.</b>" });
    expect(screen.getByRole("alert")).toHaveTextContent("<b>Could not load.</b>");
    expect(document.querySelector("b")).toBeNull();
  });

  it("shows no error when there is none", () => {
    renderNotice();
    expect(screen.getByRole("alert").querySelector(".inline-error")).toBeNull();
  });

  it("has no accessibility violations, plain and with an error", async () => {
    const { container } = render(
      <>
        <ConflictNotice busy={false} error={undefined} onKeepMine={vi.fn()} onLoadNewer={vi.fn()} />
        <ConflictNotice busy error="A problem." onKeepMine={vi.fn()} onLoadNewer={vi.fn()} />
      </>,
    );
    await expectNoA11yViolations(container);
  });
});
