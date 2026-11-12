import { type ReactElement, useEffect, useRef, useState } from "react";
import type { DocumentSaver } from "../../../lib/documents/document-saver.ts";
import { canMove, type Direction, destinationsFor } from "../../../lib/documents/item-moves.ts";
import { useItemActions } from "../../../lib/documents/use-item-actions.ts";
import { findNode, type OutlineNode } from "../../../lib/documents/use-outline.ts";
import { Button } from "../../atoms/Button/Button.tsx";
import { InlineError } from "../../atoms/InlineError/InlineError.tsx";
import { DeleteConfirmation } from "../../molecules/DeleteConfirmation/DeleteConfirmation.tsx";
import { MoveItemForm } from "../../molecules/MoveItemForm/MoveItemForm.tsx";
import { RenameItemForm } from "../../molecules/RenameItemForm/RenameItemForm.tsx";
import "./ItemToolbar.css";

type Mode = "viewing" | "renaming" | "moving" | "confirming-delete";
type ReturnTarget = "rename" | "move" | "delete";

export interface ItemToolbarProps {
  readonly projectId: string;
  /** The open item: every action is about this one. The title is the outline's. */
  readonly item: { readonly id: string; readonly title: string };
  /** The outline as it is on the screen. */
  readonly nodes: readonly OutlineNode[];
  /** The autosave of the open item, which holds its version. */
  readonly saver: DocumentSaver;
  /** Reads the outline again after a rename or a move. */
  readonly refresh: () => Promise<readonly OutlineNode[] | undefined>;
  /** Called once the item no longer exists, so the screen can close it. */
  readonly onDeleted: () => void;
  /** Says something to a screen reader. */
  readonly announce: (message: string) => void;
}

function consequenceOfDeleting(node: OutlineNode | undefined): string {
  const scenes = node?.children.length ?? 0;
  if (scenes === 0) return "Its text is deleted too, and this cannot be undone.";
  return `Its ${scenes} ${scenes === 1 ? "scene" : "scenes"} and all of their text are deleted too, and this cannot be undone.`;
}

/**
 * The actions on the open item: rename it, move it up or down, move it into another act or chapter
 * (or out to the top level), and delete it. Moving needs no dragging: every move is a button.
 *
 * The buttons that cannot do anything now (the first item cannot go up) stay in place and stay
 * focusable, marked as unavailable, so the focus never jumps away when an item reaches the end of
 * its list. Rename, the move list and the delete question each take the place of the buttons, open
 * with the focus where it is safest, and give it back to the button that opened them.
 */
export function ItemToolbar({
  projectId,
  item,
  nodes,
  saver,
  refresh,
  onDeleted,
  announce,
}: ItemToolbarProps): ReactElement {
  const [mode, setMode] = useState<Mode>("viewing");
  const actions = useItemActions({
    projectId,
    itemId: item.id,
    nodes,
    saver,
    refresh,
    onDeleted,
    announce,
  });
  const renameRef = useRef<HTMLButtonElement | null>(null);
  const moveToRef = useRef<HTMLButtonElement | null>(null);
  const deleteRef = useRef<HTMLButtonElement | null>(null);
  const keepRef = useRef<HTMLButtonElement | null>(null);
  // Which button gets the focus back when the buttons are shown again.
  const returnTo = useRef<ReturnTarget | undefined>(undefined);

  useEffect(() => {
    if (mode === "viewing" && returnTo.current !== undefined) {
      const target = { rename: renameRef, move: moveToRef, delete: deleteRef }[returnTo.current];
      target.current?.focus();
      returnTo.current = undefined;
    }
    if (mode === "confirming-delete") keepRef.current?.focus();
  }, [mode]);

  const backToButtons = (focus: ReturnTarget): void => {
    returnTo.current = focus;
    actions.forgetProblem();
    setMode("viewing");
  };

  const found = findNode(nodes, item.id);
  const destinations = destinationsFor(nodes, item.id);
  const legend = `Actions for “${item.title}”`;

  const step = (direction: Direction): void => {
    if (!canMove(nodes, item.id, direction)) return;
    void actions.move(direction);
  };

  let content: ReactElement;
  if (mode === "renaming") {
    content = (
      <RenameItemForm
        currentTitle={item.title}
        busy={actions.busy}
        problem={actions.problem}
        onSave={(title) => {
          void actions.rename(title).then((done) => {
            if (done) backToButtons("rename");
          });
        }}
        onCancel={() => {
          backToButtons("rename");
        }}
      />
    );
  } else if (mode === "moving") {
    content = (
      <MoveItemForm
        destinations={destinations}
        busy={actions.busy}
        problem={actions.problem}
        onMove={(parentId) => {
          void actions.moveTo(parentId).then((done) => {
            if (done) backToButtons("move");
          });
        }}
        onCancel={() => {
          backToButtons("move");
        }}
      />
    );
  } else if (mode === "confirming-delete") {
    content = (
      <DeleteConfirmation
        title={item.title}
        noun="item"
        consequence={consequenceOfDeleting(found?.node)}
        busy={actions.busy}
        error={actions.problem?.general[0]}
        onConfirm={() => {
          void actions.remove();
        }}
        onCancel={() => {
          backToButtons("delete");
        }}
        keepRef={keepRef}
      />
    );
  } else {
    const up = canMove(nodes, item.id, "up");
    const down = canMove(nodes, item.id, "down");
    content = (
      <>
        <div className="item-toolbar__buttons">
          <Button
            variant="secondary"
            ref={renameRef}
            busy={actions.busy}
            onClick={() => {
              actions.forgetProblem();
              setMode("renaming");
            }}
          >
            Rename
          </Button>
          <Button
            variant="secondary"
            busy={actions.busy}
            {...(up ? {} : { "aria-disabled": true })}
            onClick={() => {
              step("up");
            }}
          >
            Move up
          </Button>
          <Button
            variant="secondary"
            busy={actions.busy}
            {...(down ? {} : { "aria-disabled": true })}
            onClick={() => {
              step("down");
            }}
          >
            Move down
          </Button>
          {destinations.length === 0 ? null : (
            <Button
              variant="secondary"
              ref={moveToRef}
              busy={actions.busy}
              onClick={() => {
                actions.forgetProblem();
                setMode("moving");
              }}
            >
              Move to…
            </Button>
          )}
          <Button
            variant="secondary"
            ref={deleteRef}
            busy={actions.busy}
            onClick={() => {
              actions.forgetProblem();
              setMode("confirming-delete");
            }}
          >
            Delete
          </Button>
        </div>
        {actions.problem === undefined ? null : (
          <div role="alert" className="item-toolbar__problem">
            {actions.problem.general.map((message, index) => (
              <InlineError key={message} id={`${item.id}-problem-${index}`}>
                {message}
              </InlineError>
            ))}
          </div>
        )}
        <p role="status" className="item-toolbar__status">
          {actions.busy ? "Working…" : null}
        </p>
      </>
    );
  }

  return (
    <fieldset className="item-toolbar">
      <legend className="item-toolbar__legend">{legend}</legend>
      {content}
    </fieldset>
  );
}
