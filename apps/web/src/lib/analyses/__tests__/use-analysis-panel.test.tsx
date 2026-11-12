import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeAnalysis,
  makeEstimate,
  makeFailed,
  makeFinding,
  makeSucceeded,
  page,
} from "../../../test-support/analyses-handlers.ts";
import { deferred } from "../../../test-support/session-harness.ts";
import { signedInManager } from "../../../test-support/signed-in-manager.ts";
import { type Analysis, type AnalysisTarget, analysesApi } from "../../api/analyses-api.ts";
import { ApiError, NetworkError } from "../../api/problem.ts";
import { AuthProvider } from "../../auth/session.tsx";
import {
  HISTORY_PAGE_SIZE,
  POLL_FAILURE_LIMIT,
  pollDelay,
  type UseAnalysisPanelOptions,
  useAnalysisPanel,
} from "../use-analysis-panel.ts";

const WHOLE: AnalysisTarget = { scope: "project" };
const ITEM: AnalysisTarget = { scope: "document", documentId: "doc-1" };

function apiError(status: number, code?: string, retryAfterSeconds?: number): ApiError {
  return new ApiError({ status, code, detail: undefined, issues: [], retryAfterSeconds });
}

/** The API calls, replaced by spies. Each test plans its own answers. */
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

async function renderPanel(initial: Partial<UseAnalysisPanelOptions> = {}) {
  const context = await signedInManager();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthProvider manager={context.manager}>{children}</AuthProvider>
  );
  const props: UseAnalysisPanelOptions = {
    projectId: "project-1",
    target: WHOLE,
    enabled: true,
    ...initial,
  };
  const rendered = renderHook((options: UseAnalysisPanelOptions) => useAnalysisPanel(options), {
    wrapper,
    initialProps: props,
  });
  await flush();
  return { ...rendered, props };
}

/** Lets promises settle, and moves the clock on. */
async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Presses Start and lets the answer come. */
async function pressStart(result: { current: { start: () => void } }): Promise<void> {
  await act(async () => {
    result.current.start();
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("pollDelay", () => {
  it("asks every 2 seconds at first and every 4 seconds later", () => {
    expect(pollDelay(0, 0)).toBe(2000);
    expect(pollDelay(14, 0)).toBe(2000);
    expect(pollDelay(15, 0)).toBe(4000);
    expect(pollDelay(100, 0)).toBe(4000);
  });

  it("waits longer after answers that did not come, up to 10 seconds", () => {
    expect(pollDelay(0, 1)).toBe(4000);
    expect(pollDelay(0, 2)).toBe(8000);
    expect(pollDelay(0, 3)).toBe(10_000);
    expect(pollDelay(50, 30)).toBe(10_000);
  });
});

describe("loading the estimate and the history", () => {
  it("loads nothing while the panel has never been opened", async () => {
    const api = spies();
    const { result } = await renderPanel({ enabled: false });
    expect(api.estimate).not.toHaveBeenCalled();
    expect(api.list).not.toHaveBeenCalled();
    expect(result.current.estimate).toEqual({ status: "idle" });
    expect(result.current.history).toEqual({ status: "idle" });
  });

  it("loads both when the panel is opened", async () => {
    const api = spies();
    const old = makeSucceeded([makeFinding()]);
    api.list.mockResolvedValue(page([old], "next-1"));
    const { result, rerender, props } = await renderPanel({ enabled: false });

    rerender({ ...props, enabled: true });
    await flush();

    expect(api.estimate).toHaveBeenCalledWith("project-1", WHOLE, expect.anything());
    expect(api.list).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({ limit: HISTORY_PAGE_SIZE }),
    );
    expect(result.current.estimate).toMatchObject({ status: "ready" });
    expect(result.current.history).toEqual({
      status: "ready",
      items: [old],
      nextCursor: "next-1",
      loadingMore: false,
    });
  });

  it("asks for the estimate of the item when the target is an item, and again when it changes", async () => {
    const api = spies();
    const { rerender, props } = await renderPanel({ target: ITEM });
    expect(api.estimate).toHaveBeenLastCalledWith("project-1", ITEM, expect.anything());

    rerender({ ...props, target: WHOLE });
    await flush();
    expect(api.estimate).toHaveBeenLastCalledWith("project-1", WHOLE, expect.anything());
    expect(api.estimate).toHaveBeenCalledTimes(2);
  });

  it("does not ask again when the target is a new object that means the same", async () => {
    const api = spies();
    const { rerender, props } = await renderPanel({
      target: { scope: "document", documentId: "a" },
    });
    rerender({ ...props, target: { scope: "document", documentId: "a" } });
    await flush();
    expect(api.estimate).toHaveBeenCalledTimes(1);
  });

  it("asks for no estimate when there is nothing to look at", async () => {
    const api = spies();
    const { result } = await renderPanel({ target: undefined });
    expect(api.estimate).not.toHaveBeenCalled();
    expect(result.current.estimate).toEqual({ status: "idle" });
  });

  it("drops an estimate that arrives after the target has changed", async () => {
    const api = spies();
    const slow = deferred<ReturnType<typeof makeEstimate>>();
    api.estimate.mockReturnValueOnce(slow.promise);
    const { result, rerender, props } = await renderPanel({ target: ITEM });
    api.estimate.mockResolvedValue(makeEstimate({ characters: 111 }));

    rerender({ ...props, target: WHOLE });
    await flush();
    slow.resolve(makeEstimate({ characters: 999 }));
    await flush();

    expect(result.current.estimate).toMatchObject({
      status: "ready",
      estimate: { characters: 111 },
    });
  });

  it("shows a failed estimate in words, and loads again after Try again", async () => {
    const api = spies();
    api.estimate.mockRejectedValueOnce(new NetworkError());
    const { result } = await renderPanel();
    expect(result.current.estimate).toEqual({
      status: "failed",
      message: "Can't reach the server to load the cost estimate.",
    });

    act(() => {
      result.current.retryEstimate();
    });
    await flush();
    expect(result.current.estimate).toMatchObject({ status: "ready" });
  });

  it("shows a failed history in words", async () => {
    const api = spies();
    api.list.mockRejectedValueOnce(apiError(500));
    const { result } = await renderPanel();
    expect(result.current.history).toEqual({
      status: "failed",
      message: "Could not load your earlier scans.",
    });
  });

  it("forgets everything about a project that was left", async () => {
    const api = spies();
    api.list.mockResolvedValue(page([makeSucceeded([makeFinding()])]));
    const { result, rerender, props } = await renderPanel();
    expect(result.current.history).toMatchObject({ status: "ready" });

    api.list.mockResolvedValue(page([]));
    rerender({ ...props, projectId: "project-2" });
    await flush();

    expect(api.list).toHaveBeenLastCalledWith("project-2", expect.anything());
    expect(result.current.history).toMatchObject({ status: "ready", items: [] });
  });
});

describe("starting a run", () => {
  it("shows starting, then running, and posts the target", async () => {
    const api = spies();
    const answer = deferred<Analysis>();
    api.start.mockReturnValue(answer.promise);
    const { result } = await renderPanel({ target: ITEM });

    await pressStart(result);
    expect(result.current.run).toEqual({ phase: "starting" });
    expect(api.start).toHaveBeenCalledWith("project-1", ITEM, expect.anything());
    expect(result.current.announcement.text).toBe("Starting the scan.");

    const pending = makeAnalysis();
    answer.resolve(pending);
    await flush();
    expect(result.current.run).toEqual({
      phase: "running",
      analysis: pending,
      trouble: false,
      cancelling: false,
    });
  });

  it("ignores a second press while the first is being sent", async () => {
    const api = spies();
    api.start.mockReturnValue(new Promise<Analysis>(() => undefined));
    const { result } = await renderPanel();

    await act(async () => {
      result.current.start();
      result.current.start();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.start).toHaveBeenCalledTimes(1);
  });

  it("ignores a press while a run is going", async () => {
    const api = spies();
    api.start.mockResolvedValue(makeAnalysis());
    api.get.mockResolvedValue(makeAnalysis());
    const { result } = await renderPanel();
    await pressStart(result);
    expect(result.current.run.phase).toBe("running");

    await pressStart(result);
    expect(api.start).toHaveBeenCalledTimes(1);
  });

  it("does nothing when there is nothing to look at", async () => {
    const api = spies();
    const { result } = await renderPanel({ target: undefined });
    await pressStart(result);
    expect(api.start).not.toHaveBeenCalled();
    expect(result.current.run).toEqual({ phase: "idle" });
  });

  it.each([
    [422, "manuscript-empty", "problem", "Write something first"],
    [413, "manuscript-too-large", "problem", "single act or scene"],
    [503, "ai-unavailable", "unavailable", "not switched on"],
    [503, "ai-budget-reached", "unavailable", "budget"],
  ])("explains a %i (%s) and goes back to idle", async (status, code, kind, words) => {
    const api = spies();
    api.start.mockRejectedValue(apiError(status, code));
    const { result } = await renderPanel();

    await pressStart(result);

    expect(result.current.run).toEqual({ phase: "idle" });
    expect(result.current.problem).toMatchObject({ kind, message: expect.stringContaining(words) });
    expect(result.current.announcement.text).toContain(words);
  });

  it("tells when the used-up allowance will be back", async () => {
    const api = spies();
    api.start.mockRejectedValue(apiError(429, "ai-daily-limit", 5400));
    const { result } = await renderPanel();
    await pressStart(result);
    expect(result.current.problem?.message).toContain("Try again in 2 hours.");
  });

  it("clears an old problem when a new run is started", async () => {
    const api = spies();
    api.start.mockRejectedValueOnce(apiError(422, "manuscript-empty"));
    api.start.mockResolvedValue(makeAnalysis());
    api.get.mockResolvedValue(makeAnalysis());
    const { result } = await renderPanel();
    await pressStart(result);
    expect(result.current.problem).toBeDefined();

    await pressStart(result);
    expect(result.current.problem).toBeUndefined();
  });

  it("can close a problem", async () => {
    const api = spies();
    api.start.mockRejectedValue(apiError(422, "manuscript-empty"));
    const { result } = await renderPanel();
    await pressStart(result);
    act(() => {
      result.current.dismissProblem();
    });
    expect(result.current.problem).toBeUndefined();
  });

  it("watches the run that is already going, when it is in this project (409)", async () => {
    const api = spies();
    const running = makeAnalysis();
    api.start.mockRejectedValue(apiError(409, "run-in-progress"));
    api.list.mockResolvedValueOnce(page([])).mockResolvedValue(page([running]));
    const { result } = await renderPanel();
    api.get.mockResolvedValue(running);

    await pressStart(result);

    expect(result.current.run).toMatchObject({ phase: "running", analysis: running });
    expect(result.current.problem).toBeUndefined();
  });

  it("says so when the run that is going is somewhere else (409)", async () => {
    const api = spies();
    api.start.mockRejectedValue(apiError(409, "run-in-progress"));
    const { result } = await renderPanel();

    await pressStart(result);

    expect(result.current.run).toEqual({ phase: "idle" });
    expect(result.current.problem?.message).toContain("perhaps in another project");
  });

  it("says so also when the history cannot be read after a 409", async () => {
    const api = spies();
    api.start.mockRejectedValue(apiError(409, "run-in-progress"));
    const { result } = await renderPanel();
    api.list.mockRejectedValue(new NetworkError());

    await pressStart(result);

    expect(result.current.problem?.message).toContain("perhaps in another project");
  });

  it("shows an answer that is already finished without polling", async () => {
    const api = spies();
    const done = makeSucceeded([makeFinding()]);
    api.start.mockResolvedValue(done);
    const { result } = await renderPanel();

    await pressStart(result);
    await flush(60_000);

    expect(result.current.run).toEqual({ phase: "finished", analysis: done });
    expect(api.get).not.toHaveBeenCalled();
  });

  it("drops the answer to a start when the project was left meanwhile", async () => {
    const api = spies();
    const answer = deferred<Analysis>();
    api.start.mockReturnValue(answer.promise);
    const { result, rerender, props } = await renderPanel();
    await pressStart(result);

    rerender({ ...props, projectId: "project-2" });
    await flush();
    answer.resolve(makeAnalysis());
    await flush(10_000);

    expect(result.current.run).toEqual({ phase: "idle" });
    expect(api.get).not.toHaveBeenCalled();
  });
});

describe("watching a run", () => {
  async function startedRun() {
    const api = spies();
    const pending = makeAnalysis();
    api.start.mockResolvedValue(pending);
    const panel = await renderPanel();
    await pressStart(panel.result);
    return { api, pending, ...panel };
  }

  it("asks about the run every two seconds and shows the result when it ends", async () => {
    const { api, pending, result } = await startedRun();
    const done = makeSucceeded([makeFinding(), makeFinding()], { id: pending.id });
    api.get.mockResolvedValueOnce(pending).mockResolvedValue(done);

    await flush(1999);
    expect(api.get).not.toHaveBeenCalled();
    await flush(1);
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith("project-1", pending.id, expect.anything());
    expect(result.current.run.phase).toBe("running");

    await flush(2000);
    expect(result.current.run).toEqual({ phase: "finished", analysis: done });
    expect(result.current.announcement.text).toBe("The scan has finished. 2 findings.");
  });

  it("stops asking once the run has ended", async () => {
    const { api, pending, result } = await startedRun();
    api.get.mockResolvedValue(makeSucceeded([], { id: pending.id }));
    await flush(2000);
    expect(result.current.run.phase).toBe("finished");

    await flush(60_000);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("says it plainly when no plot hole was found, and when there is exactly one", async () => {
    const { api, pending, result } = await startedRun();
    api.get.mockResolvedValue(makeSucceeded([], { id: pending.id }));
    await flush(2000);
    expect(result.current.announcement.text).toBe(
      "The scan has finished. No plot holes were found.",
    );
  });

  it("announces one finding in the singular", async () => {
    const { api, pending, result } = await startedRun();
    api.get.mockResolvedValue(makeSucceeded([makeFinding()], { id: pending.id }));
    await flush(2000);
    expect(result.current.announcement.text).toBe("The scan has finished. 1 finding.");
  });

  it("shows a run that failed as finished, with its code, and says it did not finish", async () => {
    const { api, pending, result } = await startedRun();
    const failed = makeFailed("overloaded", { id: pending.id });
    api.get.mockResolvedValue(failed);
    await flush(2000);
    expect(result.current.run).toEqual({ phase: "finished", analysis: failed });
    expect(result.current.announcement.text).toBe("The scan did not finish.");
  });

  it("loads the estimate and the history again when the run has ended", async () => {
    const { api, pending } = await startedRun();
    const estimates = api.estimate.mock.calls.length;
    const lists = api.list.mock.calls.length;
    api.get.mockResolvedValue(makeSucceeded([], { id: pending.id }));

    await flush(2000);

    expect(api.estimate.mock.calls.length).toBe(estimates + 1);
    expect(api.list.mock.calls.length).toBe(lists + 1);
  });

  it("keeps showing the previous history while the new one is loading", async () => {
    const { api, pending, result } = await startedRun();
    api.list.mockReturnValue(new Promise(() => undefined));
    api.get.mockResolvedValue(makeSucceeded([], { id: pending.id }));
    await flush(2000);
    expect(result.current.history.status).toBe("ready");
  });

  it("tells the writer about trouble after three answers that did not come, and recovers", async () => {
    const { api, pending, result } = await startedRun();
    api.get.mockRejectedValue(new NetworkError());

    await flush(2000);
    await flush(4000);
    expect(result.current.run).toMatchObject({ phase: "running", trouble: false });
    await flush(8000);
    expect(result.current.run).toMatchObject({ phase: "running", trouble: true });

    api.get.mockResolvedValue(pending);
    await flush(10_000);
    expect(result.current.run).toMatchObject({ phase: "running", trouble: false });
  });

  it("carries on when one answer did not come, and still finds the end", async () => {
    const { api, pending, result } = await startedRun();
    const done = makeSucceeded([], { id: pending.id });
    api.get.mockRejectedValueOnce(apiError(502)).mockResolvedValue(done);
    await flush(2000);
    await flush(4000);
    expect(result.current.run).toEqual({ phase: "finished", analysis: done });
  });

  it("gives up after a long time without an answer and says what to do", async () => {
    const { api, result } = await startedRun();
    api.get.mockRejectedValue(new NetworkError());
    await flush(2000);
    for (let i = 1; i < POLL_FAILURE_LIMIT; i++) await flush(10_000);

    expect(result.current.run).toEqual({ phase: "idle" });
    expect(result.current.problem?.message).toContain("reload the page");
    const calls = api.get.mock.calls.length;
    await flush(60_000);
    expect(api.get.mock.calls.length).toBe(calls);
  });

  it("goes back to idle when the run is gone (404)", async () => {
    const { api, result } = await startedRun();
    api.get.mockRejectedValue(apiError(404));
    await flush(2000);
    expect(result.current.run).toEqual({ phase: "idle" });
    expect(result.current.problem?.message).toBe("That scan no longer exists.");
  });

  it("stops asking when the panel goes away", async () => {
    const { api, unmount } = await startedRun();
    api.get.mockResolvedValue(makeAnalysis());
    unmount();
    await flush(60_000);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("stops asking, and forgets the run, when another project is opened", async () => {
    const { api, rerender, props, result } = await startedRun();
    api.get.mockResolvedValue(makeAnalysis());
    rerender({ ...props, projectId: "project-2" });
    await flush(60_000);
    expect(api.get).not.toHaveBeenCalled();
    expect(result.current.run).toEqual({ phase: "idle" });
  });

  it("keeps asking while the panel is closed, so that the result is there when it is opened", async () => {
    const { api, pending, rerender, props, result } = await startedRun();
    const done = makeSucceeded([makeFinding()], { id: pending.id });
    api.get.mockResolvedValue(done);
    rerender({ ...props, enabled: false });
    await flush(2000);
    expect(result.current.run).toEqual({ phase: "finished", analysis: done });
  });
});

describe("finding a run that was going when the page was opened", () => {
  it("watches it again", async () => {
    const api = spies();
    const running = makeAnalysis();
    api.list.mockResolvedValue(page([running]));
    api.get.mockResolvedValue(makeSucceeded([], { id: running.id }));

    const { result } = await renderPanel();
    expect(result.current.run).toMatchObject({ phase: "running", analysis: running });

    await flush(2000);
    expect(result.current.run.phase).toBe("finished");
  });

  it("does not take over a run that this screen has just started", async () => {
    const api = spies();
    const mine = makeAnalysis();
    api.start.mockResolvedValue(mine);
    api.get.mockResolvedValue(mine);
    const { result } = await renderPanel();
    await pressStart(result);
    api.list.mockResolvedValue(page([mine]));

    act(() => {
      result.current.retryHistory();
    });
    await flush();

    expect(api.get).not.toHaveBeenCalled();
    expect(result.current.run).toMatchObject({ phase: "running", analysis: mine });
  });

  it("leaves finished runs in the history alone", async () => {
    const api = spies();
    api.list.mockResolvedValue(page([makeSucceeded([]), makeFailed("timeout")]));
    const { result } = await renderPanel();
    expect(result.current.run).toEqual({ phase: "idle" });
  });
});

describe("cancelling", () => {
  async function runningPanel() {
    const api = spies();
    const pending = makeAnalysis();
    api.start.mockResolvedValue(pending);
    api.get.mockResolvedValue(pending);
    const panel = await renderPanel();
    await pressStart(panel.result);
    return { api, pending, ...panel };
  }

  async function pressCancel(result: { current: { cancel: () => void } }): Promise<void> {
    await act(async () => {
      result.current.cancel();
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it("shows that it is cancelling, then the cancelled run", async () => {
    const { api, pending, result } = await runningPanel();
    const answer = deferred<Analysis>();
    api.cancel.mockReturnValue(answer.promise);

    await pressCancel(result);
    expect(result.current.run).toMatchObject({ phase: "running", cancelling: true });
    expect(api.cancel).toHaveBeenCalledWith("project-1", pending.id, expect.anything());

    const canceled = makeFailed("canceled", { id: pending.id });
    answer.resolve(canceled);
    await flush();
    expect(result.current.run).toEqual({ phase: "finished", analysis: canceled });
  });

  it("stops asking about the run while it is being cancelled", async () => {
    const { api, result } = await runningPanel();
    api.cancel.mockReturnValue(new Promise<Analysis>(() => undefined));
    await pressCancel(result);
    await flush(20_000);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("ignores a second press of Cancel", async () => {
    const { api, result } = await runningPanel();
    api.cancel.mockReturnValue(new Promise<Analysis>(() => undefined));
    await pressCancel(result);
    await pressCancel(result);
    expect(api.cancel).toHaveBeenCalledTimes(1);
  });

  it("shows the result when the run had finished just before Cancel", async () => {
    const { api, pending, result } = await runningPanel();
    const done = makeSucceeded([makeFinding()], { id: pending.id });
    api.cancel.mockResolvedValue(done);
    await pressCancel(result);
    expect(result.current.run).toEqual({ phase: "finished", analysis: done });
  });

  it("goes on watching, and says so, when the cancel did not work", async () => {
    const { api, pending, result } = await runningPanel();
    api.cancel.mockRejectedValue(new NetworkError());
    await pressCancel(result);

    expect(result.current.problem?.message).toBe(
      "The scan could not be cancelled. Please try again.",
    );
    expect(result.current.run).toMatchObject({ phase: "running", cancelling: false });
    const done = makeSucceeded([], { id: pending.id });
    api.get.mockResolvedValue(done);
    await flush(2000);
    expect(result.current.run.phase).toBe("finished");
  });

  it("goes back to idle when the run is already gone (404)", async () => {
    const { api, result } = await runningPanel();
    api.cancel.mockRejectedValue(apiError(404));
    await pressCancel(result);
    expect(result.current.run).toEqual({ phase: "idle" });
    expect(result.current.problem?.message).toBe("That scan no longer exists.");
  });

  it("does nothing when no run is going", async () => {
    const api = spies();
    const { result } = await renderPanel();
    await pressCancel(result);
    expect(api.cancel).not.toHaveBeenCalled();
  });
});

describe("earlier runs", () => {
  it("shows a finished run from the history, and closes it again", async () => {
    const api = spies();
    const old = makeSucceeded([makeFinding()]);
    api.list.mockResolvedValue(page([old]));
    const { result } = await renderPanel();

    act(() => {
      result.current.openRun(old);
    });
    expect(result.current.run).toEqual({ phase: "finished", analysis: old });

    act(() => {
      result.current.dismiss();
    });
    expect(result.current.run).toEqual({ phase: "idle" });
  });

  it("does not close anything when no result is shown", async () => {
    const api = spies();
    api.start.mockResolvedValue(makeAnalysis());
    api.get.mockResolvedValue(makeAnalysis());
    const { result } = await renderPanel();
    await pressStart(result);
    act(() => {
      result.current.dismiss();
    });
    expect(result.current.run.phase).toBe("running");
  });

  it("does not replace a run that is going when an old one is opened", async () => {
    const api = spies();
    const pending = makeAnalysis();
    api.start.mockResolvedValue(pending);
    api.get.mockResolvedValue(pending);
    const { result } = await renderPanel();
    await pressStart(result);

    act(() => {
      result.current.openRun(makeSucceeded([]));
    });
    expect(result.current.run).toMatchObject({ phase: "running", analysis: pending });
  });

  it("deletes a run and takes it out of the list", async () => {
    const api = spies();
    const keep = makeSucceeded([]);
    const gone = makeSucceeded([makeFinding()]);
    api.list.mockResolvedValue(page([keep, gone]));
    const { result } = await renderPanel();
    api.list.mockResolvedValue(page([keep]));

    await act(async () => {
      result.current.removeRun(gone);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(api.remove).toHaveBeenCalledWith("project-1", gone.id);
    expect(result.current.history).toMatchObject({ status: "ready", items: [keep] });
    expect(result.current.announcement.text).toBe("The scan was deleted.");
  });

  it("closes the result that is shown when that run is deleted", async () => {
    const api = spies();
    const shown = makeSucceeded([makeFinding()]);
    api.list.mockResolvedValue(page([shown]));
    const { result } = await renderPanel();
    act(() => {
      result.current.openRun(shown);
    });

    await act(async () => {
      result.current.removeRun(shown);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.run).toEqual({ phase: "idle" });
  });

  it("stops watching a run that is deleted while it is going", async () => {
    const api = spies();
    const pending = makeAnalysis();
    api.start.mockResolvedValue(pending);
    api.get.mockResolvedValue(pending);
    const { result } = await renderPanel();
    await pressStart(result);

    await act(async () => {
      result.current.removeRun(pending);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.run).toEqual({ phase: "idle" });
    await flush(20_000);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("treats a run that was already deleted as deleted (404)", async () => {
    const api = spies();
    const gone = makeSucceeded([]);
    api.list.mockResolvedValue(page([gone]));
    const { result } = await renderPanel();
    api.remove.mockRejectedValue(apiError(404));
    api.list.mockResolvedValue(page([]));

    await act(async () => {
      result.current.removeRun(gone);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.history).toMatchObject({ status: "ready", items: [] });
    expect(result.current.problem).toBeUndefined();
  });

  it("keeps the run and says so when the delete did not work", async () => {
    const api = spies();
    const keep = makeSucceeded([]);
    api.list.mockResolvedValue(page([keep]));
    const { result } = await renderPanel();
    api.remove.mockRejectedValue(new NetworkError());

    await act(async () => {
      result.current.removeRun(keep);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.history).toMatchObject({ status: "ready", items: [keep] });
    expect(result.current.problem?.message).toBe(
      "The scan could not be deleted. Please try again.",
    );
  });

  it("watches a run from the history that is still going", async () => {
    const api = spies();
    const running = makeAnalysis();
    api.list.mockResolvedValue(page([makeSucceeded([])]));
    const { result } = await renderPanel();
    api.get.mockResolvedValue(running);

    act(() => {
      result.current.openRun(running);
    });
    expect(result.current.run).toMatchObject({ phase: "running", analysis: running });
  });
});

describe("older runs", () => {
  it("adds the next page, and shows each run once", async () => {
    const api = spies();
    const a = makeSucceeded([]);
    const b = makeSucceeded([]);
    const c = makeSucceeded([]);
    api.list.mockResolvedValue(page([a, b], "cursor-2"));
    const { result } = await renderPanel();
    api.list.mockResolvedValue(page([b, c], null));

    await act(async () => {
      result.current.loadMore();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(api.list).toHaveBeenLastCalledWith(
      "project-1",
      expect.objectContaining({ cursor: "cursor-2" }),
    );
    expect(result.current.history).toEqual({
      status: "ready",
      items: [a, b, c],
      nextCursor: null,
      loadingMore: false,
    });
  });

  it("does nothing when there is no next page", async () => {
    const api = spies();
    const { result } = await renderPanel();
    const calls = api.list.mock.calls.length;
    act(() => {
      result.current.loadMore();
    });
    expect(api.list.mock.calls.length).toBe(calls);
  });

  it("asks for the next page only once at a time", async () => {
    const api = spies();
    api.list.mockResolvedValue(page([makeSucceeded([])], "cursor-2"));
    const { result } = await renderPanel();
    api.list.mockReturnValue(new Promise(() => undefined));

    await act(async () => {
      result.current.loadMore();
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      result.current.loadMore();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(result.current.history).toMatchObject({ loadingMore: true });
  });

  it("keeps the runs it has and says so when the next page did not load", async () => {
    const api = spies();
    const a = makeSucceeded([]);
    api.list.mockResolvedValue(page([a], "cursor-2"));
    const { result } = await renderPanel();
    api.list.mockRejectedValue(new NetworkError());

    await act(async () => {
      result.current.loadMore();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.history).toMatchObject({
      status: "ready",
      items: [a],
      loadingMore: false,
    });
    expect(result.current.problem?.message).toContain("Can't reach the server");
  });
});
