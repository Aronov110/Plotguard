import { type KeyboardEvent, type ReactElement, type Ref, useId } from "react";
import { Button } from "../../atoms/Button/Button.tsx";
import { InlineError } from "../../atoms/InlineError/InlineError.tsx";
import "./DeleteConfirmation.css";

export interface DeleteConfirmationProps {
  /** Named in the question, so there is no doubt which one is meant. */
  readonly title: string;
  /** What is being deleted, in one word: "project", "item". It is in the buttons and the status. */
  readonly noun: string;
  /** What else is lost, as a sentence that says it cannot be undone. */
  readonly consequence: string;
  /** The delete is running. */
  readonly busy: boolean;
  /** Why the last attempt failed, in words. */
  readonly error: string | undefined;
  readonly onConfirm: () => void;
  /** Keep it: close the question and change nothing. Also called by the Escape key. */
  readonly onCancel: () => void;
  /** Attach to the keep button: the question opens with the focus there, the safe choice. */
  readonly keepRef?: Ref<HTMLButtonElement>;
}

/**
 * The question asked before something is deleted for good. It names it, says what will be lost and
 * that it cannot be undone. The safe answer ("Keep project", "Keep item") is the one that has the
 * focus when the question opens, so pressing Enter by accident deletes nothing; Escape also keeps it.
 */
export function DeleteConfirmation({
  title,
  noun,
  consequence,
  busy,
  error,
  onConfirm,
  onCancel,
  keepRef,
}: DeleteConfirmationProps): ReactElement {
  const ids = useId();
  const questionId = `${ids}-question`;
  const errorId = `${ids}-error`;

  const handleKeyDown = (event: KeyboardEvent<HTMLFieldSetElement>): void => {
    if (event.key === "Escape" && !busy) {
      event.stopPropagation();
      onCancel();
    }
  };

  return (
    // A fieldset is the native "group" element. Its keyboard handler only adds Escape to buttons
    // that already work with Enter and Space.
    <fieldset
      aria-labelledby={questionId}
      className="delete-confirmation"
      onKeyDown={handleKeyDown}
    >
      <p className="delete-confirmation__text">
        <strong id={questionId}>Delete “{title}”?</strong> {consequence}
      </p>
      {error === undefined ? null : (
        <div role="alert">
          <InlineError id={errorId}>{error}</InlineError>
        </div>
      )}
      <div className="delete-confirmation__buttons">
        <Button variant="danger" busy={busy} onClick={onConfirm}>
          Delete {noun}
        </Button>
        <Button variant="secondary" ref={keepRef} onClick={onCancel}>
          Keep {noun}
        </Button>
      </div>
      <p role="status" className="delete-confirmation__status">
        {busy ? `Deleting the ${noun}…` : null}
      </p>
    </fieldset>
  );
}
