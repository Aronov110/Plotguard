import { useRef, useState } from "react";
import { documentsApi, type UpdateDocumentInput } from "../api/documents-api.ts";
import { ApiError, NetworkError } from "../api/problem.ts";
import { useAuth } from "../auth/session.tsx";
import {
  describeBlockedAction,
  describeItemActionError,
  type ItemAction,
  type ItemActionProblem,
} from "./document-feedback.ts";
import type { DocumentSaver, SavedDocument } from "./document-saver.ts";
import { type Direction, describePlace, placeOf, stepPosition } from "./item-moves.ts";
import { findNode, type OutlineNode } from "./use-outline.ts";

export interface UseItemActionsOptions {
  readonly projectId: string;
  /** The open item: the one every action is about. */
  readonly itemId: string;
  /** The outline as it is on the screen, which the moves are worked out from. */
  readonly nodes: readonly OutlineNode[];
  /** The autosave of the open item, which holds its version and takes turns with the text saves. */
  readonly saver: DocumentSaver;
  /** Reads the outline again from the server. */
  readonly refresh: () => Promise<readonly OutlineNode[] | undefined>;
  /** Called once the item no longer exists, so the screen can close it. */
  readonly onDeleted: () => void;
  /** Says something to a screen reader. The screen keeps the place where it is spoken. */
  readonly announce: (message: string) => void;
}

export interface ItemActions {
  /** A request is running. */
  readonly busy: boolean;
  /** Why the last action failed, in words. A new object for every failure. */
  readonly problem: ItemActionProblem | undefined;
  /** Gives the item a new title. Resolves with true when it is done (or nothing had to change). */
  readonly rename: (title: string) => Promise<boolean>;
  /** Moves the item one place up or down among its neighbours. */
  readonly move: (direction: Direction) => Promise<boolean>;
  /** Moves the item to the end of another act or chapter (`parentId`), or of the top level (`null`). */
  readonly moveTo: (parentId: string | null) => Promise<boolean>;
  /** Deletes the item, and with it everything inside it. Resolves with true when it is gone. */
  readonly remove: () => Promise<boolean>;
  /** Forgets the last problem, for example when the form that showed it is closed. */
  readonly forgetProblem: () => void;
}

/**
 * What the item toolbar does: rename, move and delete the open item. One request runs at a time (a
 * second press while it runs does nothing), a failure becomes words, and after a rename or move the
 * outline is read again so that it shows what the server has.
 *
 * Rename and move take their turn through the autosave, which holds the item's version: the text that
 * is waiting is saved first, and the new version is kept, so the writer's next text save does not
 * conflict with their own rename.
 */
export function useItemActions(options: UseItemActionsOptions): ItemActions {
  const { projectId, itemId, nodes, saver, refresh, onDeleted, announce } = options;
  const { withAuth } = useAuth();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ItemActionProblem | undefined>(undefined);
  // A ref as well as state: two presses in a row can arrive before React has re-rendered the button.
  const running = useRef(false);

  const titleOfItem = (): string => findNode(nodes, itemId)?.node.title ?? "The item";

  const fail = (error: unknown, action: ItemAction): void => {
    // Anything but a refused request or a missing connection is a bug or a changed API: the writer
    // sees a general message, and the cause goes to the console.
    if (!(error instanceof ApiError) && !(error instanceof NetworkError)) console.error(error);
    setProblem(describeItemActionError(error, action));
  };

  /** Runs one request at a time. Resolves with true when it is done. */
  const guarded = async (work: () => Promise<boolean>): Promise<boolean> => {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setProblem(undefined);
    try {
      return await work();
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  /** A change to the item itself, taking its turn through the autosave. */
  const change = async (
    action: "rename" | "move",
    changes: UpdateDocumentInput,
  ): Promise<boolean> => {
    const result = await saver.exclusive(
      (version): Promise<SavedDocument> =>
        withAuth(() => documentsApi.update(projectId, itemId, changes, { ifMatch: version })),
    );
    if (result.ok) return true;
    if (result.reason === "failed") {
      fail(result.error, action);
      return false;
    }
    setProblem({ title: undefined, general: [describeBlockedAction(result.reason, action)] });
    // The item is gone: show the outline as the server has it.
    if (result.reason === "gone") void refresh();
    return false;
  };

  const announceMove = (tree: readonly OutlineNode[] | undefined, title: string): void => {
    const place = tree === undefined ? undefined : placeOf(tree, itemId);
    if (place === undefined) {
      announce(`“${title}” was moved.`);
      return;
    }
    const where = place.parent === undefined ? "at the top level" : `in “${place.parent.title}”`;
    announce(`“${title}” moved. It is now ${describePlace(place)} ${where}.`);
  };

  return {
    busy,
    problem,

    rename: (title) =>
      guarded(async () => {
        const trimmed = title.trim();
        if (trimmed === "") {
          setProblem({ title: "Enter a title.", general: [] });
          return false;
        }
        // The API trims too. Nothing to send when the title is the one it already has.
        if (trimmed === findNode(nodes, itemId)?.node.title) return true;
        if (!(await change("rename", { title: trimmed }))) return false;
        await refresh();
        announce(`Renamed to “${trimmed}”.`);
        return true;
      }),

    move: (direction) =>
      guarded(async () => {
        const position = stepPosition(nodes, itemId, direction);
        if (position === undefined) return false;
        const title = titleOfItem();
        if (!(await change("move", { position }))) return false;
        announceMove(await refresh(), title);
        return true;
      }),

    moveTo: (parentId) =>
      guarded(async () => {
        const title = titleOfItem();
        if (!(await change("move", { parentId }))) return false;
        announceMove(await refresh(), title);
        return true;
      }),

    remove: () =>
      guarded(async () => {
        const title = titleOfItem();
        try {
          await withAuth(() => documentsApi.remove(projectId, itemId));
        } catch (error) {
          // Already gone, for example deleted in another tab: that is what the writer wanted.
          if (!(error instanceof ApiError && error.status === 404)) {
            fail(error, "delete");
            return false;
          }
        }
        // Nothing is left to save into. Stopping the autosave only now means that a failed delete
        // leaves the text safe.
        saver.abandon();
        onDeleted();
        announce(`“${title}” was deleted.`);
        await refresh();
        return true;
      }),

    forgetProblem: () => {
      setProblem(undefined);
    },
  };
}
