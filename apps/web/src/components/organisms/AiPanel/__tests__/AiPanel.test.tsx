import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analysesApi } from "../../../../lib/api/analyses-api.ts";
import { ApiError } from "../../../../lib/api/problem.ts";
import { AuthProvider } from "../../../../lib/auth/session.tsx";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import {
  makeAnalysis,
  makeEstimate,
  makeFailed,
  makeFinding,
  makeSucceeded,
  page,
} from "../../../../test-support/analyses-handlers.ts";
import { signedInManager } from "../../../../test-support/signed-in-manager.ts";
import { AiPanel, type AiPanelProps } from "../AiPanel.tsx";

const TITLES = new Map([
  ["doc-1", "The harbour"],
  ["doc-2", "The vault"],
]);

function apiError(status: number, code?: string): ApiError {
  return new ApiError({
    status,
    code,
    detail: undefined,
    issues: [],
    retryAfterSeconds: undefined,
  });
}

function spies() {
  return {
    estimate: vi.spyOn(analysesApi, "estimate").mockResolvedValue(makeEstimate()),
    start: vi.spyOn(analysesApi, "start"),
    get: vi.spyOn(analysesApi, "get"),
    list: vi.spyOn(analysesApi, "list").mockResolvedValue(page([])),
    cancel: vi.spyOn(analysesApi, "cancel"),
    remove: vi.spyOn(analysesApi, "remove").mockResolvedValue(undefined),
  };
}

async function renderPanel(props: Partial<AiPanelProps> = {}) {
  const context = await signedInManager();
  const user = vi.isFakeTimers()
    ? userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    : userEvent.setup();
  const view = render(
    <AuthProvider manager={context.manager}>
      <MemoryRouter initialEntries={["/app/projects/project-1/write"]}>
        <AiPanel
          projectId="project-1"
          openItem={undefined}
          titles={TITLES}
          onOpenItem={() => undefined}
          {...props}
        />
      </MemoryRouter>
    </AuthProvider>,
  );
  return { user, ...view };
}

async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function openPanel(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: /Plot-hole finder/ }));
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  // Testing Library only moves fake timers on when it sees a `jest` global; under Vitest it would
  // otherwise wait for a timer that never fires, and every `user.click` would hang.
  vi.stubGlobal("jest", { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AiPanel: opening and closing", () => {
  it("starts closed, and loads nothing until it is opened", async () => {
    const api = spies();
    await renderPanel();
    const toggle = screen.getByRole("button", { name: /Plot-hole finder/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Run the scan" })).not.toBeInTheDocument();
    await flush(5000);
    expect(api.estimate).not.toHaveBeenCalled();
    expect(api.list).not.toHaveBeenCalled();
  });

  it("opens and closes with the one button, which the panel's heading holds", async () => {
    spies();
    const { user } = await renderPanel();
    expect(screen.getByRole("heading", { level: 2, name: /Plot-hole finder/ })).toBeInTheDocument();

    await openPanel(user);
    const toggle = screen.getByRole("button", { name: /Plot-hole finder/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Run the scan" })).toBeVisible();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Run the scan" })).not.toBeInTheDocument();
  });

  it("can be opened from the keyboard", async () => {
    spies();
    const { user } = await renderPanel();
    await user.tab();
    expect(screen.getByRole("button", { name: /Plot-hole finder/ })).toHaveFocus();
    await user.keyboard("{Enter}");
    await flush();
    expect(screen.getByRole("button", { name: "Run the scan" })).toBeVisible();
  });

  it("shows the cost, the allowance and the privacy notice with the Run button", async () => {
    spies();
    const { user } = await renderPanel();
    await openPanel(user);

    expect(screen.getByText(/Costs about \$0\.09 to \$0\.33\./)).toBeVisible();
    expect(screen.getByText(/You have 10 scans left/)).toBeVisible();
    const run = screen.getByRole("button", { name: "Run the scan" });
    expect(run).toHaveAccessibleDescription(/sent to Anthropic/);
  });

  it("says there are no earlier scans when there are none", async () => {
    spies();
    const { user } = await renderPanel();
    await openPanel(user);
    expect(screen.getByRole("heading", { level: 3, name: "Earlier scans" })).toBeVisible();
    expect(screen.getByText("No earlier scans.")).toBeVisible();
  });
});

describe("AiPanel: what to read", () => {
  it("reads the whole project when no item is open, and says why the item cannot be chosen", async () => {
    const api = spies();
    api.start.mockReturnValue(new Promise(() => undefined));
    const { user } = await renderPanel();
    await openPanel(user);

    expect(screen.getByRole("radio", { name: "The whole project" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "The open item" })).toBeDisabled();
    expect(api.estimate).toHaveBeenCalledWith("project-1", { scope: "project" }, expect.anything());

    await user.click(screen.getByRole("button", { name: "Run the scan" }));
    expect(api.start).toHaveBeenCalledWith("project-1", { scope: "project" }, expect.anything());
  });

  it("reads the open item by default, and asks the estimate about it", async () => {
    const api = spies();
    api.start.mockReturnValue(new Promise(() => undefined));
    const { user } = await renderPanel({ openItem: { id: "doc-1", title: "The harbour" } });
    await openPanel(user);

    expect(screen.getByRole("radio", { name: "The open item: “The harbour”" })).toBeChecked();
    expect(api.estimate).toHaveBeenCalledWith(
      "project-1",
      { scope: "document", documentId: "doc-1" },
      expect.anything(),
    );
    await user.click(screen.getByRole("button", { name: "Run the scan" }));
    expect(api.start).toHaveBeenCalledWith(
      "project-1",
      { scope: "document", documentId: "doc-1" },
      expect.anything(),
    );
  });

  it("reads the whole project when the writer chooses it, even with an item open", async () => {
    const api = spies();
    const { user } = await renderPanel({ openItem: { id: "doc-1", title: "The harbour" } });
    await openPanel(user);

    await user.click(screen.getByRole("radio", { name: "The whole project" }));
    await flush();
    expect(api.estimate).toHaveBeenLastCalledWith(
      "project-1",
      { scope: "project" },
      expect.anything(),
    );
  });

  it("falls back to the whole project when the open item is closed", async () => {
    const api = spies();
    const context = await signedInManager();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const tree = (openItem: AiPanelProps["openItem"]) => (
      <AuthProvider manager={context.manager}>
        <MemoryRouter>
          <AiPanel
            projectId="project-1"
            openItem={openItem}
            titles={TITLES}
            onOpenItem={() => undefined}
          />
        </MemoryRouter>
      </AuthProvider>
    );
    const { rerender } = render(tree({ id: "doc-1", title: "The harbour" }));
    await openPanel(user);
    rerender(tree(undefined));
    await flush();

    expect(screen.getByRole("radio", { name: "The whole project" })).toBeChecked();
    expect(api.estimate).toHaveBeenLastCalledWith(
      "project-1",
      { scope: "project" },
      expect.anything(),
    );
  });
});

describe("AiPanel: running a scan", () => {
  async function startedPanel(props: Partial<AiPanelProps> = {}) {
    const api = spies();
    const pending = makeAnalysis();
    api.start.mockResolvedValue(pending);
    api.get.mockResolvedValue(pending);
    const panel = await renderPanel(props);
    await openPanel(panel.user);
    await panel.user.click(screen.getByRole("button", { name: "Run the scan" }));
    await flush();
    return { api, pending, ...panel };
  }

  it("shows the progress and a Cancel button while it runs, and keeps the choice still", async () => {
    await startedPanel();
    expect(screen.getByRole("progressbar", { name: "The scan is running" })).toBeVisible();
    expect(screen.getByText(/Reading your text…/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Scanning…" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: "Cancel the scan" })).toBeVisible();
    expect(screen.getByRole("radio", { name: "The whole project" })).toBeDisabled();
  });

  it("counts the seconds", async () => {
    await startedPanel();
    await flush(3000);
    expect(screen.getByText(/Reading your text… [1-9]\d* s\./)).toBeVisible();
  });

  it("announces the start and, later, the finish, in a live region", async () => {
    const { api, pending } = await startedPanel();
    const live = screen
      .getAllByRole("status")
      .find((node) => node.classList.contains("visually-hidden"));
    expect(live).toHaveTextContent("Starting the scan.");

    api.get.mockResolvedValue(makeSucceeded([makeFinding(), makeFinding()], { id: pending.id }));
    await flush(2000);
    expect(live).toHaveTextContent("The scan has finished. 2 findings.");
  });

  it("shows the findings when the scan ends, with links to the scenes, and lets the writer run again", async () => {
    const { api, pending } = await startedPanel();
    api.get.mockResolvedValue(
      makeSucceeded(
        [
          makeFinding({
            title: "Elena is alive again",
            evidence: [{ documentId: "doc-2", quote: "You are late.", verified: true }],
          }),
        ],
        { id: pending.id },
      ),
    );
    await flush(2000);

    expect(screen.getByRole("heading", { level: 4, name: "Elena is alive again" })).toBeVisible();
    expect(screen.getByRole("link", { name: "The vault" })).toHaveAttribute(
      "href",
      "/app/projects/project-1/write?document=doc-2",
    );
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run the scan" })).not.toHaveAttribute(
      "aria-disabled",
    );
  });

  it("tells the screen which item a finding's link opens", async () => {
    const onOpenItem = vi.fn();
    const { api, pending, user } = await startedPanel({ onOpenItem });
    api.get.mockResolvedValue(
      makeSucceeded(
        [
          makeFinding({
            evidence: [{ documentId: "doc-2", quote: "You are late.", verified: true }],
          }),
        ],
        { id: pending.id },
      ),
    );
    await flush(2000);
    await user.click(screen.getByRole("link", { name: "The vault" }));
    expect(onOpenItem).toHaveBeenCalledWith("doc-2");
  });

  it("closes a result", async () => {
    const { api, pending, user } = await startedPanel();
    api.get.mockResolvedValue(makeSucceeded([], { id: pending.id }));
    await flush(2000);
    await user.click(screen.getByRole("button", { name: "Close this result" }));
    expect(screen.queryByRole("heading", { level: 3, name: /^Scan of/ })).not.toBeInTheDocument();
  });

  it("explains a scan that did not finish", async () => {
    const { api, pending } = await startedPanel();
    api.get.mockResolvedValue(makeFailed("overloaded", { id: pending.id }));
    await flush(2000);
    expect(screen.getByText(/The AI service is busy or down for the moment/)).toBeVisible();
  });

  it("cancels, and shows that the scan was cancelled", async () => {
    const { api, pending, user } = await startedPanel();
    api.cancel.mockResolvedValue(makeFailed("canceled", { id: pending.id }));
    await user.click(screen.getByRole("button", { name: "Cancel the scan" }));
    await flush();
    expect(api.cancel).toHaveBeenCalledWith("project-1", pending.id, expect.anything());
    expect(screen.getByText("You cancelled this scan.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Cancel the scan" })).not.toBeInTheDocument();
  });

  it("shows Cancelling… while the cancel is on its way", async () => {
    const { api, user } = await startedPanel();
    api.cancel.mockReturnValue(new Promise(() => undefined));
    await user.click(screen.getByRole("button", { name: "Cancel the scan" }));
    await flush();
    expect(screen.getByRole("button", { name: "Cancelling…" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("does not start a second scan when Run is pressed again", async () => {
    const { api, user } = await startedPanel();
    await user.click(screen.getByRole("button", { name: "Scanning…" }));
    expect(api.start).toHaveBeenCalledTimes(1);
  });
});

describe("AiPanel: things that go wrong", () => {
  it("shows why a scan could not start, in an alert that can be closed", async () => {
    const api = spies();
    api.start.mockRejectedValue(apiError(422, "manuscript-empty"));
    const { user } = await renderPanel();
    await openPanel(user);
    await user.click(screen.getByRole("button", { name: "Run the scan" }));
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent("There is no text to read yet.");
    await user.click(screen.getByRole("button", { name: "Close this message" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers no Run button when the AI scan is not switched on", async () => {
    const api = spies();
    api.estimate.mockResolvedValue(makeEstimate({ available: false }));
    const { user } = await renderPanel();
    await openPanel(user);
    expect(screen.getByText("The AI scan is not switched on on this server.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Run the scan" })).not.toBeInTheDocument();
  });

  it("offers no Run button after the server says the day's budget is used", async () => {
    const api = spies();
    api.start.mockRejectedValue(apiError(503, "ai-budget-reached"));
    const { user } = await renderPanel();
    await openPanel(user);
    await user.click(screen.getByRole("button", { name: "Run the scan" }));
    await flush();
    // Once in the notice and once in the live region that announces it.
    expect(screen.getAllByText(/The AI budget for today is used up/)[0]).toBeVisible();
    expect(screen.queryByRole("button", { name: "Run the scan" })).not.toBeInTheDocument();
  });

  it("disables Run, and says why, when the text is too long for one scan", async () => {
    const api = spies();
    api.estimate.mockResolvedValue(makeEstimate({ fits: false }));
    const { user } = await renderPanel();
    await openPanel(user);
    expect(screen.getByText(/This text is too long for one scan/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Run the scan" })).toBeDisabled();
  });

  it("shows a cost estimate that failed, and tries again", async () => {
    const api = spies();
    api.estimate.mockRejectedValueOnce(apiError(500));
    const { user } = await renderPanel();
    await openPanel(user);
    expect(screen.getByText("Could not load the cost estimate.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await flush();
    expect(screen.getByText(/Costs about/)).toBeVisible();
  });

  it("shows a history that failed, and tries again", async () => {
    const api = spies();
    api.list.mockRejectedValueOnce(apiError(500));
    const { user } = await renderPanel();
    await openPanel(user);
    expect(screen.getByText("Could not load your earlier scans.")).toBeVisible();

    await user.click(screen.getAllByRole("button", { name: "Try again" })[0] as HTMLElement);
    await flush();
    expect(screen.getByText("No earlier scans.")).toBeVisible();
  });

  it("can still run a scan when the estimate failed", async () => {
    const api = spies();
    api.estimate.mockRejectedValue(apiError(500));
    api.start.mockReturnValue(new Promise(() => undefined));
    const { user } = await renderPanel();
    await openPanel(user);
    await user.click(screen.getByRole("button", { name: "Run the scan" }));
    expect(api.start).toHaveBeenCalledTimes(1);
  });
});

describe("AiPanel: earlier scans", () => {
  const OLD = makeSucceeded([makeFinding({ title: "An old problem" })], {
    scope: "document",
    documentId: "doc-1",
    createdAt: "2026-11-10T09:00:00.000Z",
  });

  it("lists them with what they read and how they ended", async () => {
    const api = spies();
    api.list.mockResolvedValue(page([OLD, makeFailed("timeout"), makeSucceeded([])]));
    const { user } = await renderPanel();
    await openPanel(user);

    const items = screen
      .getAllByRole("listitem")
      .filter((item) => item.classList.contains("ai-panel__run"));
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("“The harbour”, 1 finding");
    expect(items[1]).toHaveTextContent("the whole project, did not finish");
    expect(items[2]).toHaveTextContent("the whole project, no findings");
  });

  it("opens one, and moves the focus to its result", async () => {
    const api = spies();
    api.list.mockResolvedValue(page([OLD]));
    const { user } = await renderPanel();
    await openPanel(user);

    await user.click(screen.getByRole("button", { name: /^Open the scan of “The harbour”/ }));
    await flush();
    expect(screen.getByRole("heading", { level: 4, name: "An old problem" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 3, name: /^Scan of “The harbour”/ })).toHaveFocus();
  });

  it("watches one that is still going", async () => {
    const api = spies();
    const running = makeAnalysis();
    api.list.mockResolvedValue(page([running]));
    api.get.mockResolvedValue(running);
    const { user } = await renderPanel();
    await openPanel(user);
    // The panel found it by itself, so it is already being watched.
    expect(screen.getByRole("progressbar")).toBeVisible();
    expect(screen.getByRole("button", { name: /^Watch the scan of/ })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel the scan" }));
  });

  it("asks before deleting, with the safe answer focused, and Keep deletes nothing", async () => {
    const api = spies();
    api.list.mockResolvedValue(page([OLD]));
    const { user } = await renderPanel();
    await openPanel(user);

    await user.click(screen.getByRole("button", { name: /^Delete the scan of “The harbour”/ }));
    const question = screen.getByRole("group", { name: /^Delete “scan of/ });
    expect(question).toHaveTextContent("This cannot be undone.");
    expect(within(question).getByRole("button", { name: "Keep scan" })).toHaveFocus();

    await user.click(within(question).getByRole("button", { name: "Keep scan" }));
    expect(screen.queryByRole("group", { name: /^Delete “scan of/ })).not.toBeInTheDocument();
    expect(api.remove).not.toHaveBeenCalled();
  });

  it("deletes it when confirmed, and puts the focus on the list's heading", async () => {
    const api = spies();
    api.list.mockResolvedValue(page([OLD]));
    const { user } = await renderPanel();
    await openPanel(user);

    await user.click(screen.getByRole("button", { name: /^Delete the scan of “The harbour”/ }));
    api.list.mockResolvedValue(page([]));
    await user.click(screen.getByRole("button", { name: "Delete scan" }));
    await flush();

    expect(api.remove).toHaveBeenCalledWith("project-1", OLD.id);
    expect(screen.getByText("No earlier scans.")).toBeVisible();
    expect(screen.getByRole("heading", { level: 3, name: "Earlier scans" })).toHaveFocus();
  });

  it("shows older scans when there are more", async () => {
    const api = spies();
    const older = makeSucceeded([], { scope: "document", documentId: "doc-2" });
    api.list.mockResolvedValue(page([OLD], "cursor-2"));
    const { user } = await renderPanel();
    await openPanel(user);

    api.list.mockResolvedValue(page([older], null));
    await user.click(screen.getByRole("button", { name: "Show older scans" }));
    await flush();

    expect(
      screen.getAllByRole("listitem").filter((item) => item.classList.contains("ai-panel__run")),
    ).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Show older scans" })).not.toBeInTheDocument();
  });

  it("shows a deleted item's scan as that, and a very long title in full", async () => {
    const api = spies();
    const longTitle = "L".repeat(200);
    api.list.mockResolvedValue(
      page([
        makeSucceeded([], { scope: "document", documentId: "gone" }),
        makeSucceeded([], { scope: "document", documentId: "long" }),
      ]),
    );
    const { user } = await renderPanel({ titles: new Map([["long", longTitle]]) });
    await openPanel(user);
    expect(screen.getByText(/an item that has since been deleted, no findings/)).toBeVisible();
    expect(screen.getByText(new RegExp(longTitle))).toBeVisible();
  });
});

// axe uses timers of its own, so these tests run with real ones and wait for the screen with findBy.
describe("AiPanel: accessibility", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("has no violations closed and open, with a history", async () => {
    const api = spies();
    api.list.mockResolvedValue(page([makeSucceeded([makeFinding()]), makeFailed("refused")]));
    const { user, container } = await renderPanel({
      openItem: { id: "doc-1", title: "The harbour" },
    });
    await expectNoA11yViolations(container);

    await user.click(screen.getByRole("button", { name: /Plot-hole finder/ }));
    await screen.findAllByRole("button", { name: /^Open the scan of/ });
    await expectNoA11yViolations(container);
  });

  it("has no violations with a result shown, and with the delete question open", async () => {
    const api = spies();
    api.list.mockResolvedValue(
      page([makeSucceeded([makeFinding(), makeFinding({ severity: "minor" })])]),
    );
    const { user, container } = await renderPanel();
    await user.click(screen.getByRole("button", { name: /Plot-hole finder/ }));
    await user.click(await screen.findByRole("button", { name: /^Open the scan of/ }));
    await screen.findByRole("heading", { level: 3, name: /^Scan of/ });
    await expectNoA11yViolations(container);

    await user.click(screen.getByRole("button", { name: /^Delete the scan of/ }));
    await screen.findByRole("group", { name: /^Delete “scan of/ });
    await expectNoA11yViolations(container);
  });

  it("has no violations while a scan is running, and with a problem shown", async () => {
    const api = spies();
    const running = makeAnalysis();
    api.list.mockResolvedValue(page([running]));
    api.get.mockResolvedValue(running);
    const { user, container } = await renderPanel();
    await user.click(screen.getByRole("button", { name: /Plot-hole finder/ }));
    await screen.findByRole("progressbar");
    await expectNoA11yViolations(container);

    api.cancel.mockRejectedValue(apiError(500));
    await user.click(screen.getByRole("button", { name: "Cancel the scan" }));
    await screen.findByRole("alert");
    await expectNoA11yViolations(container);
  });
});
