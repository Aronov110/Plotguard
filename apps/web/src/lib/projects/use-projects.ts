import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ApiError, NetworkError } from "../api/problem.ts";
import { type Project, type ProjectPage, projectsApi } from "../api/projects-api.ts";
import { useAuth } from "../auth/session.tsx";
import { describeListError } from "./project-form-feedback.ts";

/** What the last successful "load more" added, so the screen can announce it and move the focus. */
export interface JustLoaded {
  /** The first project the page added (never one that was already shown). */
  readonly firstId: string;
  readonly count: number;
  /** Grows by one for every load, so two loads of the same size are still told apart. */
  readonly serial: number;
}

export type ProjectsView =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  | {
      readonly status: "ready";
      readonly items: readonly Project[];
      readonly hasMore: boolean;
      readonly loadingMore: boolean;
      /** Why the last "load more" failed. The projects already shown stay. */
      readonly moreError: string | undefined;
      readonly justLoaded: JustLoaded | undefined;
    };

export interface UseProjects {
  readonly view: ProjectsView;
  /** Loads the first page again after it failed. */
  readonly retry: () => void;
  /** Loads the next page. Does nothing while one is loading or when there is no next page. */
  readonly loadMore: () => void;
  /** Puts a project the person just created at the top of the list. */
  readonly add: (project: Project) => void;
}

interface State {
  readonly phase: "loading" | "failed" | "ready";
  readonly message: string | undefined;
  /** What the API returned, in its order. */
  readonly fetched: readonly Project[];
  /** Created on this screen, newest first. Kept apart so a late first page cannot hide them. */
  readonly created: readonly Project[];
  readonly nextCursor: string | null;
  readonly loadingMore: boolean;
  readonly moreError: string | undefined;
  readonly justLoaded: JustLoaded | undefined;
  readonly serial: number;
}

type Action =
  | { readonly type: "load-started" }
  | { readonly type: "first-page"; readonly page: ProjectPage }
  | { readonly type: "first-failed"; readonly message: string }
  | { readonly type: "more-started" }
  | { readonly type: "more-loaded"; readonly page: ProjectPage }
  | { readonly type: "more-failed"; readonly message: string }
  | { readonly type: "created"; readonly project: Project };

const INITIAL: State = {
  phase: "loading",
  message: undefined,
  fetched: [],
  created: [],
  nextCursor: null,
  loadingMore: false,
  moreError: undefined,
  justLoaded: undefined,
  serial: 0,
};

/** Every project once, the first time it appears: created ones before fetched ones. */
function merge(created: readonly Project[], fetched: readonly Project[]): Project[] {
  const seen = new Set<string>();
  const merged: Project[] = [];
  for (const project of [...created, ...fetched]) {
    if (seen.has(project.id)) continue;
    seen.add(project.id);
    merged.push(project);
  }
  return merged;
}

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "load-started":
      return {
        ...INITIAL,
        created: state.created,
        serial: state.serial,
      };
    case "first-page":
      return {
        ...state,
        phase: "ready",
        fetched: action.page.items,
        nextCursor: action.page.nextCursor,
      };
    case "first-failed":
      return { ...state, phase: "failed", message: action.message };
    case "more-started":
      return { ...state, loadingMore: true, moreError: undefined, justLoaded: undefined };
    case "more-loaded": {
      // A project can come back twice, for example one that changed while the person was on this
      // screen. It is shown once, where it was first seen.
      const known = new Set(merge(state.created, state.fetched).map((project) => project.id));
      const added = merge([], action.page.items).filter((project) => !known.has(project.id));
      const first = added[0];
      const serial = first === undefined ? state.serial : state.serial + 1;
      return {
        ...state,
        fetched: [...state.fetched, ...added],
        nextCursor: action.page.nextCursor,
        loadingMore: false,
        justLoaded:
          first === undefined ? undefined : { firstId: first.id, count: added.length, serial },
        serial,
      };
    }
    case "more-failed":
      return { ...state, loadingMore: false, moreError: action.message };
    case "created":
      return {
        ...state,
        created: [action.project, ...state.created.filter((p) => p.id !== action.project.id)],
        justLoaded: undefined,
      };
  }
}

/** A failure that is not part of normal life (a bug, a changed API) goes to the console. */
function reportIfUnexpected(error: unknown): void {
  if (!(error instanceof ApiError) && !(error instanceof NetworkError)) console.error(error);
}

/**
 * Loads the signed-in person's projects, one page at a time, and keeps the list while the screen is
 * open. A request that is still running when the screen is left is cancelled, so its answer cannot
 * arrive in a screen that is gone.
 */
export function useProjects(): UseProjects {
  const { withAuth } = useAuth();
  const [state, dispatch] = useReducer(reduce, INITIAL);
  const [attempt, setAttempt] = useState(0);
  // A ref as well as state: two presses in a row can arrive before React has re-rendered the button.
  const moreRunning = useRef(false);
  const moreController = useRef<AbortController | undefined>(undefined);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` only counts the presses of "Try again"; changing it is what runs the load again
  useEffect(() => {
    const controller = new AbortController();
    dispatch({ type: "load-started" });
    withAuth(() => projectsApi.list({ signal: controller.signal }))
      .then((page) => {
        if (!controller.signal.aborted) dispatch({ type: "first-page", page });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        reportIfUnexpected(error);
        dispatch({ type: "first-failed", message: describeListError(error) });
      });
    return () => {
      controller.abort();
    };
  }, [attempt, withAuth]);

  useEffect(
    () => () => {
      moreController.current?.abort();
    },
    [],
  );

  const { phase, nextCursor } = state;
  const loadMore = useCallback(() => {
    if (moreRunning.current || phase !== "ready" || nextCursor === null) return;
    moreRunning.current = true;
    const controller = new AbortController();
    moreController.current = controller;
    dispatch({ type: "more-started" });
    withAuth(() => projectsApi.list({ cursor: nextCursor, signal: controller.signal }))
      .then((page) => {
        if (!controller.signal.aborted) dispatch({ type: "more-loaded", page });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        reportIfUnexpected(error);
        dispatch({ type: "more-failed", message: describeListError(error) });
      })
      .finally(() => {
        moreRunning.current = false;
      });
  }, [phase, nextCursor, withAuth]);

  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  const add = useCallback((project: Project) => {
    dispatch({ type: "created", project });
  }, []);

  const items = useMemo(() => merge(state.created, state.fetched), [state.created, state.fetched]);

  const view: ProjectsView =
    state.phase === "loading"
      ? { status: "loading" }
      : state.phase === "failed"
        ? { status: "failed", message: state.message ?? describeListError(undefined) }
        : {
            status: "ready",
            items,
            hasMore: state.nextCursor !== null,
            loadingMore: state.loadingMore,
            moreError: state.moreError,
            justLoaded: state.justLoaded,
          };

  return { view, retry, loadMore, add };
}
