import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Analysis,
  type AnalysisTarget,
  analysesApi,
  type Estimate,
} from "../api/analyses-api.ts";
import { ApiError, NetworkError } from "../api/problem.ts";
import { useAuth } from "../auth/session.tsx";
import { describeReadError, describeStartError } from "./analysis-feedback.ts";

/** How many earlier runs are shown at first, and added by each "Show older". */
export const HISTORY_PAGE_SIZE = 10;
/** After this many answers in a row that did not come, the panel stops asking. */
export const POLL_FAILURE_LIMIT = 30;
/** After this many in a row, the panel tells the writer that it is having trouble. */
export const POLL_TROUBLE_AFTER = 3;

/**
 * How long to wait before asking about a run again: quickly at first (a run takes seconds to
 * minutes), slower later, and slower still after answers that did not come, up to ten seconds.
 */
export function pollDelay(attempt: number, failures: number): number {
  const base = attempt < 15 ? 2000 : 4000;
  return failures === 0 ? base : Math.min(10_000, base * 2 ** failures);
}

/** Waits `ms`, or less when `signal` is aborted. Always resolves; the caller checks the signal. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

export type EstimateView =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly estimate: Estimate }
  | { readonly status: "failed"; readonly message: string };

export type HistoryView =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  | {
      readonly status: "ready";
      readonly items: readonly Analysis[];
      readonly nextCursor: string | null;
      readonly loadingMore: boolean;
    };

export type RunView =
  | { readonly phase: "idle" }
  | { readonly phase: "starting" }
  | {
      readonly phase: "running";
      readonly analysis: Analysis;
      /** The panel has had trouble asking about the run; it keeps trying. */
      readonly trouble: boolean;
      /** Cancel was pressed and the answer is awaited. */
      readonly cancelling: boolean;
    }
  | { readonly phase: "finished"; readonly analysis: Analysis };

/** Something the writer is told about, next to the Run button. */
export interface PanelProblem {
  /** `unavailable` will not change by itself, so the Run button is not offered at all. */
  readonly kind: "problem" | "unavailable";
  readonly message: string;
}

export interface UseAnalysisPanelOptions {
  readonly projectId: string;
  /** What a run would look at, or `undefined` when there is nothing to look at yet. */
  readonly target: AnalysisTarget | undefined;
  /** Whether the panel is open. Nothing is loaded for a panel that was never opened. */
  readonly enabled: boolean;
}

export interface UseAnalysisPanel {
  readonly estimate: EstimateView;
  readonly history: HistoryView;
  readonly run: RunView;
  readonly problem: PanelProblem | undefined;
  /** What a screen reader is told at the main steps. `serial` changes with every message. */
  readonly announcement: { readonly text: string; readonly serial: number };
  /** Starts a run on the target. Does nothing while one is starting or going. */
  readonly start: () => void;
  /** Stops the run that is going. */
  readonly cancel: () => void;
  /** Closes a result that is shown. */
  readonly dismiss: () => void;
  /** Shows an earlier run, or watches it when it is still going. */
  readonly openRun: (analysis: Analysis) => void;
  /** Deletes an earlier run for good. */
  readonly removeRun: (analysis: Analysis) => void;
  readonly loadMore: () => void;
  readonly retryEstimate: () => void;
  readonly retryHistory: () => void;
  readonly dismissProblem: () => void;
}

function targetKey(target: AnalysisTarget | undefined): string {
  if (target === undefined) return "none";
  return target.scope === "project" ? "project" : `document:${target.documentId}`;
}

/**
 * Everything the AI panel needs: the cost estimate, starting a run, asking about it until it ends,
 * cancelling it, and the history. A run goes on in the server, so when the page is opened again
 * with a run still going, the panel finds it in the history and watches it again.
 */
export function useAnalysisPanel({
  projectId,
  target,
  enabled,
}: UseAnalysisPanelOptions): UseAnalysisPanel {
  const { withAuth } = useAuth();
  const [estimate, setEstimate] = useState<EstimateView>({ status: "idle" });
  const [history, setHistory] = useState<HistoryView>({ status: "idle" });
  const [run, setRunState] = useState<RunView>({ phase: "idle" });
  const [problem, setProblem] = useState<PanelProblem | undefined>(undefined);
  const [announcement, setAnnouncement] = useState({ text: "", serial: 0 });
  // Changed to load the estimate and the first page of the history again.
  const [reloads, setReloads] = useState(0);

  // The run view as it is right now. State is only up to date after a render, and a double click or
  // a late answer needs the current value at once.
  const runRef = useRef<RunView>({ phase: "idle" });
  // The request or polling loop in progress, and a count that changes whenever the screen moves on
  // (another project) so that an answer to an old question is dropped.
  const live = useRef<{ controller: AbortController | undefined; epoch: number }>({
    controller: undefined,
    epoch: 0,
  });

  const setRun = useCallback((view: RunView): void => {
    runRef.current = view;
    setRunState(view);
  }, []);

  const announce = useCallback((text: string): void => {
    setAnnouncement((previous) => ({ text, serial: previous.serial + 1 }));
  }, []);

  const stopWatching = useCallback((): void => {
    live.current.controller?.abort();
    live.current.controller = undefined;
  }, []);

  const finish = useCallback(
    (analysis: Analysis): void => {
      live.current.controller = undefined;
      setRun({ phase: "finished", analysis });
      setReloads((count) => count + 1);
      if (analysis.status === "succeeded") {
        const count = analysis.result?.findings.length ?? 0;
        announce(
          count === 0
            ? "The scan has finished. No plot holes were found."
            : `The scan has finished. ${count} ${count === 1 ? "finding" : "findings"}.`,
        );
      } else {
        announce("The scan did not finish.");
      }
    },
    [announce, setRun],
  );

  /** Asks about a run until it ends. One loop at a time: starting another stops the old one. */
  const watch = useCallback(
    (first: Analysis): void => {
      stopWatching();
      const controller = new AbortController();
      live.current.controller = controller;
      const { signal } = controller;
      setRun({ phase: "running", analysis: first, trouble: false, cancelling: false });

      void (async () => {
        let attempt = 0;
        let failures = 0;
        while (!signal.aborted) {
          await sleep(pollDelay(attempt, failures), signal);
          if (signal.aborted) return;
          attempt += 1;
          try {
            const latest = await withAuth(() => analysesApi.get(projectId, first.id, { signal }));
            if (signal.aborted) return;
            failures = 0;
            if (latest.status !== "pending") {
              finish(latest);
              return;
            }
            setRun({ phase: "running", analysis: latest, trouble: false, cancelling: false });
          } catch (error) {
            if (signal.aborted) return;
            if (error instanceof ApiError && error.status === 404) {
              live.current.controller = undefined;
              setRun({ phase: "idle" });
              setProblem({ kind: "problem", message: "That scan no longer exists." });
              return;
            }
            if (!(error instanceof ApiError) && !(error instanceof NetworkError)) {
              console.error(error);
            }
            failures += 1;
            if (failures >= POLL_FAILURE_LIMIT) {
              live.current.controller = undefined;
              setRun({ phase: "idle" });
              setProblem({
                kind: "problem",
                message:
                  "Lost contact with the server. The scan may still be running: reload the page to see it.",
              });
              return;
            }
            if (failures >= POLL_TROUBLE_AFTER) {
              const current = runRef.current;
              if (current.phase === "running" && !current.trouble)
                setRun({ ...current, trouble: true });
            }
          }
        }
      })();
    },
    [finish, projectId, setRun, stopWatching, withAuth],
  );

  // Another project: stop everything about the old one and start from nothing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `projectId` is what makes this run again; it only resets what belongs to the project
  useEffect(() => {
    const state = live.current;
    return () => {
      state.epoch += 1;
      state.controller?.abort();
      state.controller = undefined;
      runRef.current = { phase: "idle" };
      setRunState({ phase: "idle" });
      setProblem(undefined);
      setEstimate({ status: "idle" });
      setHistory({ status: "idle" });
    };
  }, [projectId, setRunState]);

  const key = targetKey(target);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `target`, which is a new object on every render
  useEffect(() => {
    if (!enabled || target === undefined) {
      setEstimate({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    setEstimate((previous) => (previous.status === "ready" ? previous : { status: "loading" }));
    withAuth(() => analysesApi.estimate(projectId, target, { signal: controller.signal }))
      .then((value) => {
        if (!controller.signal.aborted) setEstimate({ status: "ready", estimate: value });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (!(error instanceof ApiError) && !(error instanceof NetworkError)) console.error(error);
        setEstimate({ status: "failed", message: describeReadError(error, "estimate") });
      });
    return () => {
      controller.abort();
    };
  }, [enabled, projectId, key, reloads, withAuth]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `reloads` only counts the reasons to load again (a run ended, "Try again"); changing it is what runs the load again
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setHistory((previous) => (previous.status === "ready" ? previous : { status: "loading" }));
    withAuth(() =>
      analysesApi.list(projectId, { limit: HISTORY_PAGE_SIZE, signal: controller.signal }),
    )
      .then((page) => {
        if (controller.signal.aborted) return;
        setHistory({
          status: "ready",
          items: page.items,
          nextCursor: page.nextCursor,
          loadingMore: false,
        });
        // A run that was going when the page was left or reloaded: watch it again.
        if (runRef.current.phase === "idle") {
          const pending = page.items.find((item) => item.status === "pending");
          if (pending !== undefined) watch(pending);
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (!(error instanceof ApiError) && !(error instanceof NetworkError)) console.error(error);
        setHistory({ status: "failed", message: describeReadError(error, "history") });
      });
    return () => {
      controller.abort();
    };
  }, [enabled, projectId, reloads, watch, withAuth]);

  const start = useCallback((): void => {
    const phase = runRef.current.phase;
    if (target === undefined || phase === "starting" || phase === "running") return;
    stopWatching();
    const controller = new AbortController();
    live.current.controller = controller;
    const { epoch } = live.current;
    setProblem(undefined);
    setRun({ phase: "starting" });
    announce("Starting the scan.");

    void (async () => {
      try {
        const analysis = await withAuth(() =>
          analysesApi.start(projectId, target, { signal: controller.signal }),
        );
        if (controller.signal.aborted || live.current.epoch !== epoch) return;
        if (analysis.status === "pending") watch(analysis);
        else finish(analysis);
      } catch (error) {
        if (controller.signal.aborted || live.current.epoch !== epoch) return;
        const failure = describeStartError(error);
        if (failure.kind !== "already-running") {
          if (!(error instanceof ApiError) && !(error instanceof NetworkError))
            console.error(error);
          setRun({ phase: "idle" });
          setProblem(failure);
          announce(failure.message);
          return;
        }
        // A run is going already. The API allows one per person, in any project: look for it here.
        try {
          const page = await withAuth(() =>
            analysesApi.list(projectId, { limit: HISTORY_PAGE_SIZE, signal: controller.signal }),
          );
          if (controller.signal.aborted || live.current.epoch !== epoch) return;
          const pending = page.items.find((item) => item.status === "pending");
          if (pending !== undefined) {
            watch(pending);
            return;
          }
        } catch {
          if (controller.signal.aborted || live.current.epoch !== epoch) return;
        }
        const message =
          "You already have a scan running, perhaps in another project. Wait until it has finished, then try again.";
        setRun({ phase: "idle" });
        setProblem({ kind: "problem", message });
        announce(message);
      }
    })();
  }, [announce, finish, projectId, setRun, stopWatching, target, watch, withAuth]);

  const cancel = useCallback((): void => {
    const current = runRef.current;
    if (current.phase !== "running" || current.cancelling) return;
    stopWatching();
    const controller = new AbortController();
    live.current.controller = controller;
    const { epoch } = live.current;
    setRun({ ...current, cancelling: true });

    void (async () => {
      try {
        const analysis = await withAuth(() =>
          analysesApi.cancel(projectId, current.analysis.id, { signal: controller.signal }),
        );
        if (controller.signal.aborted || live.current.epoch !== epoch) return;
        if (analysis.status === "pending") watch(analysis);
        else finish(analysis);
      } catch (error) {
        if (controller.signal.aborted || live.current.epoch !== epoch) return;
        if (error instanceof ApiError && error.status === 404) {
          live.current.controller = undefined;
          setRun({ phase: "idle" });
          setProblem({ kind: "problem", message: "That scan no longer exists." });
          return;
        }
        // It could not be cancelled: the run goes on, so watch it again and say so.
        setProblem({
          kind: "problem",
          message: "The scan could not be cancelled. Please try again.",
        });
        watch(current.analysis);
      }
    })();
  }, [finish, projectId, setRun, stopWatching, watch, withAuth]);

  const dismiss = useCallback((): void => {
    if (runRef.current.phase === "finished") setRun({ phase: "idle" });
  }, [setRun]);

  const openRun = useCallback(
    (analysis: Analysis): void => {
      const phase = runRef.current.phase;
      if (phase === "starting") return;
      if (analysis.status === "pending") {
        if (phase !== "running") watch(analysis);
        return;
      }
      // Looking at an old result must not stop a run that is going.
      if (phase === "running") return;
      setRun({ phase: "finished", analysis });
    },
    [setRun, watch],
  );

  const removeRun = useCallback(
    (analysis: Analysis): void => {
      const forget = (): void => {
        setHistory((previous) =>
          previous.status === "ready"
            ? { ...previous, items: previous.items.filter((item) => item.id !== analysis.id) }
            : previous,
        );
        const current = runRef.current;
        if (
          (current.phase === "finished" || current.phase === "running") &&
          current.analysis.id === analysis.id
        ) {
          stopWatching();
          setRun({ phase: "idle" });
        }
        setReloads((count) => count + 1);
      };
      void (async () => {
        try {
          await withAuth(() => analysesApi.remove(projectId, analysis.id));
          forget();
          announce("The scan was deleted.");
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) {
            forget();
            return;
          }
          if (!(error instanceof ApiError) && !(error instanceof NetworkError))
            console.error(error);
          setProblem({
            kind: "problem",
            message: "The scan could not be deleted. Please try again.",
          });
        }
      })();
    },
    [announce, projectId, setRun, stopWatching, withAuth],
  );

  const loadMore = useCallback((): void => {
    if (history.status !== "ready" || history.nextCursor === null || history.loadingMore) return;
    const cursor = history.nextCursor;
    const { epoch } = live.current;
    setHistory({ ...history, loadingMore: true });
    withAuth(() => analysesApi.list(projectId, { limit: HISTORY_PAGE_SIZE, cursor }))
      .then((page) => {
        if (live.current.epoch !== epoch) return;
        setHistory((previous) => {
          if (previous.status !== "ready") return previous;
          const known = new Set(previous.items.map((item) => item.id));
          return {
            status: "ready",
            items: [...previous.items, ...page.items.filter((item) => !known.has(item.id))],
            nextCursor: page.nextCursor,
            loadingMore: false,
          };
        });
      })
      .catch((error: unknown) => {
        if (live.current.epoch !== epoch) return;
        if (!(error instanceof ApiError) && !(error instanceof NetworkError)) console.error(error);
        setHistory((previous) =>
          previous.status === "ready" ? { ...previous, loadingMore: false } : previous,
        );
        setProblem({ kind: "problem", message: describeReadError(error, "history") });
      });
  }, [history, projectId, withAuth]);

  const retry = useCallback((): void => {
    setReloads((count) => count + 1);
  }, []);
  const dismissProblem = useCallback((): void => {
    setProblem(undefined);
  }, []);

  return {
    estimate,
    history,
    run,
    problem,
    announcement,
    start,
    cancel,
    dismiss,
    openRun,
    removeRun,
    loadMore,
    retryEstimate: retry,
    retryHistory: retry,
    dismissProblem,
  };
}
