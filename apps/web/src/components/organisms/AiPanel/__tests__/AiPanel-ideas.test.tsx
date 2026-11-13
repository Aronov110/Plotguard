import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analysesApi } from "../../../../lib/api/analyses-api.ts";
import { ApiError } from "../../../../lib/api/problem.ts";
import { AuthProvider } from "../../../../lib/auth/session.tsx";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { AiPanelHarness } from "../../../../test-support/ai-panel-harness.tsx";
import {
  makeAnalysis,
  makeEstimate,
  makeFinding,
  makeIdea,
  makeIdeasAnalysis,
  makeIdeasSucceeded,
  makeSucceeded,
  page,
} from "../../../../test-support/analyses-handlers.ts";
import { signedInManager } from "../../../../test-support/signed-in-manager.ts";
import type { AiPanelProps } from "../AiPanel.tsx";

// The idea generator in the panel. The plot-hole behaviour is in AiPanel.test.tsx.

const TITLES = new Map([
  ["doc-1", "The harbour"],
  ["doc-2", "The vault"],
]);

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
        <AiPanelHarness
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

type User = ReturnType<typeof userEvent.setup>;

async function openPanel(user: User): Promise<void> {
  await user.click(screen.getByRole("button", { name: /AI assistant/ }));
  await flush();
}

async function chooseIdeas(user: User): Promise<void> {
  await user.click(screen.getByRole("radio", { name: "Get ideas" }));
  await flush();
}

const focusField = () => screen.getByRole("textbox", { name: /What should the ideas be about/ });

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

describe("AiPanel: choosing what the AI does", () => {
  it("offers plot holes first, with no focus field", async () => {
    spies();
    const { user } = await renderPanel();
    await openPanel(user);
    expect(screen.getByRole("radio", { name: "Find plot holes" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Get ideas" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Run the scan" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows the focus field, the Get ideas button and the ideas privacy notice for ideas", async () => {
    spies();
    const { user } = await renderPanel();
    await openPanel(user);
    await chooseIdeas(user);

    expect(focusField()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Get ideas" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run the scan" })).not.toBeInTheDocument();
    const run = screen.getByRole("button", { name: "Get ideas" });
    expect(run).toHaveAccessibleDescription(/and the focus if you write one/);
  });

  it("asks for the estimate of ideas when ideas are chosen", async () => {
    const api = spies();
    const { user } = await renderPanel();
    await openPanel(user);
    await chooseIdeas(user);
    expect(api.estimate).toHaveBeenLastCalledWith(
      "project-1",
      { scope: "project" },
      expect.objectContaining({ kind: "ideas" }),
    );
  });

  it("keeps what was typed when the writer goes back and forth", async () => {
    spies();
    const { user } = await renderPanel();
    await openPanel(user);
    await chooseIdeas(user);
    await user.type(focusField(), "a stronger ending");

    await user.click(screen.getByRole("radio", { name: "Find plot holes" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await chooseIdeas(user);
    expect(focusField()).toHaveValue("a stronger ending");
  });

  it("shows the focus field and the ideas wording for a plot-hole choice again after ideas", async () => {
    spies();
    const { user } = await renderPanel();
    await openPanel(user);
    await chooseIdeas(user);
    await user.click(screen.getByRole("radio", { name: "Find plot holes" }));
    expect(screen.getByRole("button", { name: "Run the scan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run the scan" })).not.toHaveAccessibleDescription(
      /focus/,
    );
  });

  it("offers neither choice when the AI is not switched on", async () => {
    const api = spies();
    api.estimate.mockResolvedValue(makeEstimate({ available: false }));
    const { user } = await renderPanel();
    await openPanel(user);
    expect(screen.getByText(/The AI features are not switched on/)).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });
});

describe("AiPanel: running the idea generator", () => {
  it("sends the cleaned focus with the kind, and shows the ideas when they come", async () => {
    const api = spies();
    const going = makeIdeasAnalysis({ focus: "who the stranger was" });
    api.start.mockResolvedValue(going);
    const idea = makeIdea({ title: "The stranger returns", goesIn: "doc-2" });
    api.get.mockResolvedValue(makeIdeasSucceeded([idea], { id: going.id, focus: going.focus }));
    const { user } = await renderPanel();
    await openPanel(user);
    await chooseIdeas(user);
    await user.type(focusField(), "  who the stranger  {Enter}was ");
    await user.click(screen.getByRole("button", { name: "Get ideas" }));
    await flush();

    expect(api.start).toHaveBeenCalledWith(
      "project-1",
      { scope: "project" },
      expect.objectContaining({ kind: "ideas", focus: "who the stranger was" }),
    );

    await flush(2000);
    expect(
      screen.getByRole("heading", { level: 3, name: /^Ideas for the whole project/ }),
    ).toBeVisible();
    expect(screen.getByText(/You asked for ideas about:/).closest("p")).toHaveTextContent(
      "who the stranger was",
    );
    expect(screen.getByRole("heading", { level: 4, name: "The stranger returns" })).toBeVisible();
    expect(screen.getByRole("link", { name: "The vault" })).toBeVisible();
  });

  it("shows progress in its own words, locks the choices and cancels", async () => {
    const api = spies();
    const going = makeIdeasAnalysis();
    api.start.mockResolvedValue(going);
    api.get.mockResolvedValue(going);
    api.cancel.mockResolvedValue(
      makeIdeasAnalysis({ id: going.id, status: "failed", errorCode: "canceled" }),
    );
    const { user } = await renderPanel();
    await openPanel(user);
    await chooseIdeas(user);
    await user.click(screen.getByRole("button", { name: "Get ideas" }));
    await flush();

    expect(screen.getByRole("progressbar", { name: "The idea request is running" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Thinking of ideas…/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Find plot holes" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Get ideas" })).toBeDisabled();
    expect(focusField()).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Cancel the request" }));
    await flush();
    expect(screen.getByText("You cancelled this idea request.")).toBeVisible();
  });

  it("keeps the focus text for the next run, and lets the choices go again", async () => {
    const api = spies();
    const going = makeIdeasAnalysis({ focus: "a stronger ending" });
    api.start.mockResolvedValue(going);
    api.get.mockResolvedValue(makeIdeasSucceeded([makeIdea()], { id: going.id }));
    const { user } = await renderPanel();
    await openPanel(user);
    await chooseIdeas(user);
    await user.type(focusField(), "a stronger ending");
    await user.click(screen.getByRole("button", { name: "Get ideas" }));
    await flush(2000);

    expect(focusField()).toHaveValue("a stronger ending");
    expect(focusField()).toBeEnabled();
    expect(screen.getByRole("radio", { name: "Find plot holes" })).toBeEnabled();
  });

  it("does not send the focus when the writer went back to plot holes", async () => {
    const api = spies();
    api.start.mockResolvedValue(makeAnalysis());
    const { user } = await renderPanel();
    await openPanel(user);
    await chooseIdeas(user);
    await user.type(focusField(), "left over");
    await user.click(screen.getByRole("radio", { name: "Find plot holes" }));
    await user.click(screen.getByRole("button", { name: "Run the scan" }));
    await flush();

    const options = api.start.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(options).not.toHaveProperty("focus");
    expect(options.kind).not.toBe("ideas");
  });

  it("announces the ideas in the live region", async () => {
    const api = spies();
    const going = makeIdeasAnalysis();
    api.start.mockResolvedValue(going);
    api.get.mockResolvedValue(makeIdeasSucceeded([makeIdea(), makeIdea()], { id: going.id }));
    const { user } = await renderPanel();
    await openPanel(user);
    await chooseIdeas(user);
    await user.click(screen.getByRole("button", { name: "Get ideas" }));
    await flush(2000);
    const live = screen
      .getAllByRole("status")
      .map((node) => node.textContent)
      .join("|");
    expect(live).toContain("The ideas are ready. 2 ideas.");
  });

  it("says why an idea request could not start", async () => {
    const api = spies();
    api.start.mockRejectedValue(
      new ApiError({
        status: 500,
        code: undefined,
        detail: undefined,
        issues: [],
        retryAfterSeconds: undefined,
      }),
    );
    const { user } = await renderPanel();
    await openPanel(user);
    await chooseIdeas(user);
    await user.click(screen.getByRole("button", { name: "Get ideas" }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The idea request could not be started. Please try again.",
    );
  });
});

describe("AiPanel: the focus limit", () => {
  it("turns Run off, with the reason tied to the field, when the focus is too long", async () => {
    const api = spies();
    const { user } = await renderPanel();
    await openPanel(user);
    await chooseIdeas(user);
    await user.click(focusField());
    await user.paste("a".repeat(501));

    expect(screen.getByRole("button", { name: "Get ideas" })).toBeDisabled();
    expect(focusField()).toHaveAccessibleDescription(/1 character too long/);
    await user.click(screen.getByRole("button", { name: "Get ideas" }));
    expect(api.start).not.toHaveBeenCalled();
  });

  it("allows exactly 500 characters", async () => {
    spies();
    const { user } = await renderPanel();
    await openPanel(user);
    await chooseIdeas(user);
    await user.click(focusField());
    await user.paste("a".repeat(500));
    expect(screen.getByRole("button", { name: "Get ideas" })).toBeEnabled();
  });

  it("does not let a long focus left in the field stop a plot-hole scan", async () => {
    spies();
    const { user } = await renderPanel();
    await openPanel(user);
    await chooseIdeas(user);
    await user.click(focusField());
    await user.paste("a".repeat(600));
    await user.click(screen.getByRole("radio", { name: "Find plot holes" }));
    expect(screen.getByRole("button", { name: "Run the scan" })).toBeEnabled();
  });
});

describe("AiPanel: a run found going", () => {
  it("shows an idea request that was going at page load in its own mode", async () => {
    const api = spies();
    const going = makeIdeasAnalysis();
    api.list.mockResolvedValue(page([going]));
    api.get.mockResolvedValue(going);
    const { user } = await renderPanel();
    await openPanel(user);

    expect(screen.getByRole("radio", { name: "Get ideas" })).toBeChecked();
    expect(screen.getByRole("progressbar", { name: "The idea request is running" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancel the request" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Thinking of ideas…/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("goes back to the writer's own choice when that run has ended", async () => {
    const api = spies();
    const going = makeIdeasAnalysis();
    api.list.mockResolvedValue(page([going]));
    api.get.mockResolvedValue(makeIdeasSucceeded([makeIdea()], { id: going.id }));
    const { user } = await renderPanel();
    await openPanel(user);
    await flush(2000);
    expect(screen.getByRole("radio", { name: "Find plot holes" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Run the scan" })).toBeInTheDocument();
  });
});

describe("AiPanel: earlier results of both kinds", () => {
  it("says which kind each one was, and what it read and how it ended", async () => {
    const api = spies();
    api.list.mockResolvedValue(
      page([
        makeIdeasSucceeded([makeIdea(), makeIdea()]),
        makeSucceeded([makeFinding()]),
        makeIdeasAnalysis({ status: "failed", errorCode: "timeout" }),
      ]),
    );
    const { user } = await renderPanel();
    await openPanel(user);
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent(/Ideas, the whole project, 2 ideas/);
    expect(rows[1]).toHaveTextContent(/Plot holes, the whole project, 1 finding/);
    expect(rows[2]).toHaveTextContent(/Ideas, the whole project, did not finish/);
    expect(screen.getByRole("heading", { level: 3, name: "Earlier results" })).toBeVisible();
  });

  it("names the right kind in the buttons", async () => {
    const api = spies();
    api.list.mockResolvedValue(page([makeIdeasSucceeded([makeIdea()]), makeSucceeded([])]));
    const { user } = await renderPanel();
    await openPanel(user);
    expect(
      screen.getByRole("button", { name: /^Open the ideas for the whole project/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /^Delete the ideas for the whole project/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /^Open the scan of the whole project/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /^Delete the scan of the whole project/ }),
    ).toBeVisible();
  });

  it("opens an earlier idea result, and moves the focus to its heading", async () => {
    const api = spies();
    const old = makeIdeasSucceeded([makeIdea({ title: "An old idea" })], { focus: "the ending" });
    api.list.mockResolvedValue(page([old]));
    const { user } = await renderPanel();
    await openPanel(user);
    await user.click(screen.getByRole("button", { name: /^Open the ideas for/ }));
    await flush();

    const heading = screen.getByRole("heading", { level: 3, name: /^Ideas for the whole project/ });
    expect(heading).toHaveFocus();
    expect(screen.getByRole("heading", { level: 4, name: "An old idea" })).toBeVisible();
    expect(screen.getByText(/You asked for ideas about:/).closest("p")).toHaveTextContent(
      "the ending",
    );
  });

  it("asks before deleting ideas, naming them and what is lost, and deletes when confirmed", async () => {
    const api = spies();
    const old = makeIdeasSucceeded([makeIdea()]);
    api.list.mockResolvedValue(page([old]));
    const { user } = await renderPanel();
    await openPanel(user);
    await user.click(screen.getByRole("button", { name: /^Delete the ideas for/ }));
    const question = screen.getByRole("group", { name: /Delete “ideas for the whole project/ });
    expect(question).toHaveTextContent("The ideas and the focus are lost for good.");
    expect(within(question).getByRole("button", { name: /Keep/ })).toHaveFocus();

    await user.click(within(question).getByRole("button", { name: /^Delete/ }));
    await flush();
    expect(api.remove).toHaveBeenCalledWith("project-1", old.id);
  });

  it("does not delete anything when the writer keeps the ideas", async () => {
    const api = spies();
    api.list.mockResolvedValue(page([makeIdeasSucceeded([makeIdea()])]));
    const { user } = await renderPanel();
    await openPanel(user);
    await user.click(screen.getByRole("button", { name: /^Delete the ideas for/ }));
    await user.click(screen.getByRole("button", { name: /Keep/ }));
    expect(api.remove).not.toHaveBeenCalled();
  });

  it("says no earlier results when there are none", async () => {
    spies();
    const { user } = await renderPanel();
    await openPanel(user);
    expect(screen.getByText("No earlier results.")).toBeVisible();
  });
});

describe("AiPanel, ideas: accessibility", () => {
  // The axe checks use real timers: fake ones would stop axe from ever finishing.
  beforeEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function openReal() {
    const { user, container } = await renderPanel();
    await user.click(screen.getByRole("button", { name: /AI assistant/ }));
    await screen.findByRole("radio", { name: "Get ideas" });
    return { user, container };
  }

  it("has no violations in ideas mode, with the focus field, empty and too long", async () => {
    spies();
    const { user, container } = await openReal();
    await user.click(screen.getByRole("radio", { name: "Get ideas" }));
    await screen.findByRole("textbox");
    await expectNoA11yViolations(container);

    await user.click(focusField());
    await user.paste("a".repeat(501));
    await expectNoA11yViolations(container);
  });

  it("has no violations with an idea result and earlier results of both kinds", async () => {
    const api = spies();
    const old = makeIdeasSucceeded([makeIdea({ goesIn: "doc-2" })], { focus: "the ending" });
    api.list.mockResolvedValue(page([old, makeSucceeded([makeFinding()])]));
    const { user, container } = await openReal();
    await user.click(await screen.findByRole("button", { name: /^Open the ideas for/ }));
    await screen.findByRole("heading", { level: 4 });
    await expectNoA11yViolations(container);
  });

  it("has no violations while an idea request runs", async () => {
    const api = spies();
    const going = makeIdeasAnalysis();
    api.list.mockResolvedValue(page([going]));
    api.get.mockResolvedValue(going);
    const { container } = await openReal();
    await screen.findByRole("progressbar");
    await expectNoA11yViolations(container);
  });
});

describe("AiPanel: the mode control", () => {
  it("is a group of two radio buttons with the explanation of the chosen mode under it", async () => {
    spies();
    const { user } = await renderPanel();
    await openPanel(user);
    const group = screen.getByRole("group", { name: "What do you want?" });
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
    expect(group).toHaveAccessibleDescription(/contradicts itself/);
  });

  it("changes the explanation with the choice", async () => {
    spies();
    const { user } = await renderPanel();
    await openPanel(user);
    await chooseIdeas(user);
    const group = screen.getByRole("group", { name: "What do you want?" });
    expect(group).toHaveAccessibleDescription(/suggestions, not corrections/);
    // (The panel's own intro also says "contradicts itself", so only the group's description is read.)
    expect(group).not.toHaveAccessibleDescription(/contradicts itself/);
  });

  it("offers the scope as two cards that are radio buttons", async () => {
    spies();
    const { user } = await renderPanel();
    await openPanel(user);
    const group = screen.getByRole("group", { name: "What should it read?" });
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
    expect(within(group).getByRole("radio", { name: "The whole project" })).toBeChecked();
  });
});
