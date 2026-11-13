import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeAnalysis,
  makeEstimate,
  makeFinding,
  makeIdea,
  makeIdeasAnalysis,
  makeIdeasSucceeded,
  makeSucceeded,
  page,
} from "../../../test-support/analyses-handlers.ts";
import { deferred } from "../../../test-support/session-harness.ts";
import { signedInManager } from "../../../test-support/signed-in-manager.ts";
import { type AnalysisTarget, analysesApi } from "../../api/analyses-api.ts";
import { ApiError } from "../../api/problem.ts";
import { AuthProvider } from "../../auth/session.tsx";
import { type UseAnalysisPanelOptions, useAnalysisPanel } from "../use-analysis-panel.ts";

// The idea generator in the panel's hook. The plot-hole behaviour is in use-analysis-panel.test.tsx.

const WHOLE: AnalysisTarget = { scope: "project" };
const ITEM: AnalysisTarget = { scope: "document", documentId: "doc-1" };

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

async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
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

async function pressStart(result: { current: { start: () => void } }): Promise<void> {
  await act(async () => {
    result.current.start();
    await vi.advanceTimersByTimeAsync(0);
  });
}

/** The options the last call to `start` was given, as a plain record. */
function startOptions(api: ReturnType<typeof spies>): Record<string, unknown> {
  return api.start.mock.calls.at(-1)?.[2] as Record<string, unknown>;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the estimate, by kind", () => {
  it("asks for the estimate of the chosen kind, and again when the kind changes", async () => {
    const api = spies();
    const { rerender, props } = await renderPanel({ kind: "ideas" });
    expect(api.estimate).toHaveBeenLastCalledWith(
      "project-1",
      WHOLE,
      expect.objectContaining({ kind: "ideas" }),
    );

    rerender({ ...props, kind: "plot_holes" });
    await flush();
    expect(api.estimate).toHaveBeenLastCalledWith(
      "project-1",
      WHOLE,
      expect.objectContaining({ kind: "plot_holes" }),
    );
    expect(api.estimate).toHaveBeenCalledTimes(2);
  });

  it("asks about plot holes when no kind is given", async () => {
    const api = spies();
    await renderPanel();
    expect(api.estimate).toHaveBeenLastCalledWith(
      "project-1",
      WHOLE,
      expect.objectContaining({ kind: "plot_holes" }),
    );
  });

  it("drops an estimate that arrives after the kind has changed", async () => {
    const api = spies();
    const slow = deferred<ReturnType<typeof makeEstimate>>();
    api.estimate.mockReturnValueOnce(slow.promise);
    const { result, rerender, props } = await renderPanel({ kind: "ideas" });
    api.estimate.mockResolvedValue(makeEstimate({ characters: 111 }));

    rerender({ ...props, kind: "plot_holes" });
    await flush();
    slow.resolve(makeEstimate({ characters: 999 }));
    await flush();

    expect(result.current.estimate).toMatchObject({
      status: "ready",
      estimate: { characters: 111 },
    });
  });

  it("does not ask for the estimate again when only the focus changes", async () => {
    const api = spies();
    const { rerender, props } = await renderPanel({ kind: "ideas", focus: "a" });
    rerender({ ...props, focus: "a stronger ending" });
    await flush();
    expect(api.estimate).toHaveBeenCalledTimes(1);
  });
});

describe("starting an idea request", () => {
  it("sends the cleaned focus and tells a screen reader", async () => {
    const api = spies();
    api.start.mockResolvedValue(makeIdeasAnalysis({ focus: "a stronger ending" }));
    const { result } = await renderPanel({
      kind: "ideas",
      focus: "  a stronger\n ending ",
      target: ITEM,
    });

    await pressStart(result);
    expect(api.start).toHaveBeenCalledWith(
      "project-1",
      ITEM,
      expect.objectContaining({ kind: "ideas", focus: "a stronger ending" }),
    );
    expect(result.current.announcement.text).toBe("Asking for ideas.");
    expect(result.current.run).toMatchObject({ phase: "running" });
  });

  it("sends no focus key when the focus is blank", async () => {
    const api = spies();
    api.start.mockResolvedValue(makeIdeasAnalysis());
    const { result } = await renderPanel({ kind: "ideas", focus: " \n\t " });
    await pressStart(result);
    expect(startOptions(api).kind).toBe("ideas");
    expect(startOptions(api)).not.toHaveProperty("focus");
  });

  it("never sends a focus for a plot-hole scan, even when the field has text", async () => {
    const api = spies();
    api.start.mockResolvedValue(makeAnalysis());
    const { result } = await renderPanel({ kind: "plot_holes", focus: "left over from before" });
    await pressStart(result);
    expect(startOptions(api)).not.toHaveProperty("focus");
    expect(startOptions(api).kind).not.toBe("ideas");
  });

  it("does not start when the focus is over the limit", async () => {
    const api = spies();
    const { result } = await renderPanel({ kind: "ideas", focus: "a".repeat(501) });
    await pressStart(result);
    expect(api.start).not.toHaveBeenCalled();
    expect(result.current.run).toEqual({ phase: "idle" });
  });

  it("starts with exactly 500 characters", async () => {
    const api = spies();
    api.start.mockResolvedValue(makeIdeasAnalysis());
    const { result } = await renderPanel({ kind: "ideas", focus: "a".repeat(500) });
    await pressStart(result);
    expect(api.start).toHaveBeenCalledTimes(1);
  });

  it("does not hold a long focus against a plot-hole scan", async () => {
    const api = spies();
    api.start.mockResolvedValue(makeAnalysis());
    const { result } = await renderPanel({ kind: "plot_holes", focus: "a".repeat(900) });
    await pressStart(result);
    expect(api.start).toHaveBeenCalledTimes(1);
  });

  it("words a failed start as an idea request, and a refused focus as a focus problem", async () => {
    const api = spies();
    api.start.mockRejectedValueOnce(apiError(500));
    const { result } = await renderPanel({ kind: "ideas" });
    await pressStart(result);
    expect(result.current.problem?.message).toBe(
      "The idea request could not be started. Please try again.",
    );

    api.start.mockRejectedValueOnce(apiError(400, "validation-error"));
    await pressStart(result);
    expect(result.current.problem?.message).toContain("focus");
  });

  it("says a run going elsewhere is not a scan, and points to another project", async () => {
    const api = spies();
    api.start.mockRejectedValue(apiError(409, "run-in-progress"));
    const { result } = await renderPanel({ kind: "ideas" });
    await pressStart(result);
    expect(result.current.problem?.message).not.toContain("scan");
    expect(result.current.problem?.message).toContain("another project");
  });
});

describe("watching an idea request", () => {
  it("finishes and announces the ideas", async () => {
    const api = spies();
    api.start.mockResolvedValue(makeIdeasAnalysis());
    const done = makeIdeasSucceeded([makeIdea(), makeIdea()]);
    api.get.mockResolvedValue(done);
    const { result } = await renderPanel({ kind: "ideas" });
    await pressStart(result);
    await flush(2000);

    expect(result.current.run).toEqual({ phase: "finished", analysis: done });
    expect(result.current.announcement.text).toBe("The ideas are ready. 2 ideas.");
  });

  it("says one idea in the singular, and says so when there are none", async () => {
    const api = spies();
    api.start.mockResolvedValue(makeIdeasAnalysis());
    api.get.mockResolvedValueOnce(makeIdeasSucceeded([makeIdea()]));
    const { result } = await renderPanel({ kind: "ideas" });
    await pressStart(result);
    await flush(2000);
    expect(result.current.announcement.text).toBe("The ideas are ready. 1 idea.");

    act(() => {
      result.current.dismiss();
    });
    api.start.mockResolvedValue(makeIdeasAnalysis());
    api.get.mockResolvedValueOnce(makeIdeasSucceeded([]));
    await pressStart(result);
    await flush(2000);
    expect(result.current.announcement.text).toBe(
      "The idea request has finished. No ideas came up.",
    );
  });

  it("announces an idea request that did not finish", async () => {
    const api = spies();
    api.start.mockResolvedValue(makeIdeasAnalysis());
    api.get.mockResolvedValue(
      makeIdeasAnalysis({ status: "failed", errorCode: "timeout", completedAt: "x" }),
    );
    const { result } = await renderPanel({ kind: "ideas" });
    await pressStart(result);
    await flush(2000);
    expect(result.current.announcement.text).toBe("The idea request did not finish.");
  });

  it("watches an idea request that was going when the page was opened, whatever kind is chosen", async () => {
    const api = spies();
    const going = makeIdeasAnalysis({ focus: "the stranger" });
    api.list.mockResolvedValue(page([going]));
    const done = makeIdeasSucceeded([makeIdea()], { id: going.id });
    api.get.mockResolvedValue(done);

    const { result } = await renderPanel({ kind: "plot_holes" });
    expect(result.current.run).toMatchObject({ phase: "running", analysis: { kind: "ideas" } });

    await flush(2000);
    expect(result.current.run).toEqual({ phase: "finished", analysis: done });
    expect(result.current.announcement.text).toBe("The ideas are ready. 1 idea.");
  });

  it("announces a plot-hole scan found at page load in the old words", async () => {
    const api = spies();
    const going = makeAnalysis();
    api.list.mockResolvedValue(page([going]));
    api.get.mockResolvedValue(makeSucceeded([makeFinding()], { id: going.id }));
    const { result } = await renderPanel({ kind: "ideas" });
    await flush(2000);
    expect(result.current.announcement.text).toBe("The scan has finished. 1 finding.");
  });

  it("says an idea request is gone when it is not found", async () => {
    const api = spies();
    api.start.mockResolvedValue(makeIdeasAnalysis());
    api.get.mockRejectedValue(apiError(404));
    const { result } = await renderPanel({ kind: "ideas" });
    await pressStart(result);
    await flush(2000);
    expect(result.current.problem?.message).toBe("That idea request no longer exists.");
  });
});

describe("cancelling and deleting an idea request", () => {
  it("words a cancel that failed", async () => {
    const api = spies();
    const going = makeIdeasAnalysis();
    api.start.mockResolvedValue(going);
    api.get.mockResolvedValue(going);
    api.cancel.mockRejectedValueOnce(apiError(500));
    const { result } = await renderPanel({ kind: "ideas" });
    await pressStart(result);
    await act(async () => {
      result.current.cancel();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.problem?.message).toBe(
      "The idea request could not be cancelled. Please try again.",
    );
  });

  it("announces a delete", async () => {
    spies();
    const { result } = await renderPanel({ kind: "ideas" });
    await act(async () => {
      result.current.removeRun(makeIdeasSucceeded([makeIdea()]));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.announcement.text).toBe("The idea request was deleted.");
  });

  it("words a delete that failed", async () => {
    const api = spies();
    api.remove.mockRejectedValueOnce(apiError(500));
    const { result } = await renderPanel({ kind: "ideas" });
    await act(async () => {
      result.current.removeRun(makeIdeasSucceeded([makeIdea()]));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.problem?.message).toBe(
      "The idea request could not be deleted. Please try again.",
    );
  });

  it("keeps the words for a plot-hole scan the same", async () => {
    const api = spies();
    api.remove.mockRejectedValueOnce(apiError(500));
    const { result } = await renderPanel();
    await act(async () => {
      result.current.removeRun(makeSucceeded([makeFinding()]));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.problem?.message).toBe(
      "The scan could not be deleted. Please try again.",
    );
  });
});
