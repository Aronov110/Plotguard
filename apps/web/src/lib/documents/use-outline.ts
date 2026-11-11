import { useCallback, useEffect, useReducer, useState } from "react";
import { type DocumentDetail, documentsApi, type OutlineItem } from "../api/documents-api.ts";
import { ApiError, NetworkError } from "../api/problem.ts";
import { useAuth } from "../auth/session.tsx";
import { describeLoadError } from "./document-feedback.ts";

/** One item of the outline: an act or chapter (with children) or a scene (without). */
export interface OutlineNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly title: string;
  readonly wordCount: number;
  readonly updatedAt: string;
  readonly children: readonly OutlineNode[];
}

/**
 * Builds the tree from the API's flat list, which is in reading order (each top-level item before its
 * children). An item whose parent is not in the list is shown at the top level instead of being lost.
 */
export function buildTree(items: readonly OutlineItem[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const childrenOf = new Map<string, OutlineNode[]>();
  const known = new Set(items.map((item) => item.id));

  const nodeOf = (item: OutlineItem): OutlineNode => ({
    id: item.id,
    parentId: item.parentId,
    title: item.title,
    wordCount: item.wordCount,
    updatedAt: item.updatedAt,
    children: childrenOf.get(item.id) ?? [],
  });

  // Children first: a node needs its list of children when it is made.
  for (const item of items) {
    if (item.parentId === null || !known.has(item.parentId)) continue;
    const list = childrenOf.get(item.parentId) ?? [];
    list.push(nodeOf(item));
    childrenOf.set(item.parentId, list);
  }
  for (const item of items) {
    if (item.parentId === null || !known.has(item.parentId)) roots.push(nodeOf(item));
  }
  return roots;
}

/** Finds an item anywhere in the tree, with its parent. */
export function findNode(
  nodes: readonly OutlineNode[],
  id: string,
): { readonly node: OutlineNode; readonly parent: OutlineNode | undefined } | undefined {
  for (const node of nodes) {
    if (node.id === id) return { node, parent: undefined };
    const child = node.children.find((candidate) => candidate.id === id);
    if (child !== undefined) return { node: child, parent: node };
  }
  return undefined;
}

/** The number of items in the tree. */
export function countNodes(nodes: readonly OutlineNode[]): number {
  return nodes.reduce((total, node) => total + 1 + node.children.length, 0);
}

export type OutlineView =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "ready"; readonly nodes: readonly OutlineNode[] };

export interface UseOutline {
  readonly view: OutlineView;
  /** Loads the outline again after it failed. */
  readonly retry: () => void;
  /** Puts a document that was just created at the end of its parent (or of the top level). */
  readonly add: (document: DocumentDetail) => void;
  /** Shows the word count the server gave after a save. */
  readonly setWordCount: (id: string, wordCount: number) => void;
}

interface State {
  readonly phase: "loading" | "failed" | "ready";
  readonly message: string | undefined;
  readonly nodes: readonly OutlineNode[];
}

type Action =
  | { readonly type: "load-started" }
  | { readonly type: "loaded"; readonly items: readonly OutlineItem[] }
  | { readonly type: "failed"; readonly message: string }
  | { readonly type: "added"; readonly document: DocumentDetail }
  | { readonly type: "word-count"; readonly id: string; readonly wordCount: number };

const INITIAL: State = { phase: "loading", message: undefined, nodes: [] };

function withWordCount(
  nodes: readonly OutlineNode[],
  id: string,
  wordCount: number,
): OutlineNode[] {
  return nodes.map((node) => ({
    ...node,
    wordCount: node.id === id ? wordCount : node.wordCount,
    children: node.children.map((child) => (child.id === id ? { ...child, wordCount } : child)),
  }));
}

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "load-started":
      return INITIAL;
    case "loaded":
      return { phase: "ready", message: undefined, nodes: buildTree(action.items) };
    case "failed":
      return { phase: "failed", message: action.message, nodes: [] };
    case "added": {
      const { document } = action;
      if (findNode(state.nodes, document.id) !== undefined) return state;
      const node: OutlineNode = {
        id: document.id,
        parentId: document.parentId,
        title: document.title,
        wordCount: document.wordCount,
        updatedAt: document.updatedAt,
        children: [],
      };
      const parent =
        document.parentId === null ? undefined : findNode(state.nodes, document.parentId);
      if (parent === undefined) return { ...state, nodes: [...state.nodes, node] };
      return {
        ...state,
        nodes: state.nodes.map((candidate) =>
          candidate.id === parent.node.id
            ? { ...candidate, children: [...candidate.children, node] }
            : candidate,
        ),
      };
    }
    case "word-count":
      return { ...state, nodes: withWordCount(state.nodes, action.id, action.wordCount) };
  }
}

/** Loads the outline of a project, and keeps it up to date while the screen is open. */
export function useOutline(projectId: string): UseOutline {
  const { withAuth } = useAuth();
  const [state, dispatch] = useReducer(reduce, INITIAL);
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` only counts the presses of "Try again"; changing it is what runs the load again
  useEffect(() => {
    const controller = new AbortController();
    dispatch({ type: "load-started" });
    withAuth(() => documentsApi.outline(projectId, { signal: controller.signal }))
      .then((items) => {
        if (!controller.signal.aborted) dispatch({ type: "loaded", items });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (!(error instanceof ApiError) && !(error instanceof NetworkError)) console.error(error);
        dispatch({ type: "failed", message: describeLoadError(error, "outline") });
      });
    return () => {
      controller.abort();
    };
  }, [projectId, attempt, withAuth]);

  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);
  const add = useCallback((document: DocumentDetail) => {
    dispatch({ type: "added", document });
  }, []);
  const setWordCount = useCallback((id: string, wordCount: number) => {
    dispatch({ type: "word-count", id, wordCount });
  }, []);

  const view: OutlineView =
    state.phase === "loading"
      ? { status: "loading" }
      : state.phase === "failed"
        ? { status: "failed", message: state.message ?? describeLoadError(undefined, "outline") }
        : { status: "ready", nodes: state.nodes };

  return { view, retry, add, setWordCount };
}
