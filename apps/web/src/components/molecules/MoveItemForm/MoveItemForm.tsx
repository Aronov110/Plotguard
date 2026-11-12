import {
  type KeyboardEvent,
  type ReactElement,
  type SubmitEvent as ReactSubmitEvent,
  useEffect,
  useId,
  useRef,
} from "react";
import { readText } from "../../../lib/auth/use-auth-form.ts";
import type { ItemActionProblem } from "../../../lib/documents/document-feedback.ts";
import type { Destination } from "../../../lib/documents/item-moves.ts";
import { Button } from "../../atoms/Button/Button.tsx";
import { Label } from "../../atoms/Label/Label.tsx";
import { Select } from "../../atoms/Select/Select.tsx";
import { ErrorSummary } from "../ErrorSummary/ErrorSummary.tsx";
import "./MoveItemForm.css";

export interface MoveItemFormProps {
  /** The places the item may go. The form is only shown when there is at least one. */
  readonly destinations: readonly Destination[];
  /** The move is running. */
  readonly busy: boolean;
  /** Why the last attempt failed, in words. A new object for every failure. */
  readonly problem: ItemActionProblem | undefined;
  /** Called with the chosen act or chapter, or `null` for the top level. */
  readonly onMove: (parentId: string | null) => void;
  /** Close the form and change nothing. Also called by the Escape key. */
  readonly onCancel: () => void;
}

/**
 * The small form that moves an item into another act or chapter, or out to the top level. It is the
 * way to move an item to another parent without dragging it. It opens with the focus on the list; a
 * problem is listed at the top with the focus moved there. The item goes to the end of the place
 * chosen, and the up and down buttons fine-tune it. Escape closes the form.
 */
export function MoveItemForm({
  destinations,
  busy,
  problem,
  onMove,
  onCancel,
}: MoveItemFormProps): ReactElement {
  const ids = useId();
  const selectId = `${ids}-where`;
  const selectRef = useRef<HTMLSelectElement | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    selectRef.current?.focus();
  }, []);

  // Each failed attempt sets a new problem object, so the focus moves again for the same words.
  useEffect(() => {
    if (problem !== undefined) summaryRef.current?.focus();
  }, [problem]);

  const handleSubmit = (event: ReactSubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const value = readText(new FormData(event.currentTarget), "where");
    const chosen = destinations.find((destination) => destination.value === value);
    if (chosen !== undefined) onMove(chosen.parentId);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>): void => {
    if (event.key === "Escape" && !busy) {
      event.stopPropagation();
      onCancel();
    }
  };

  return (
    <form className="move-item-form" noValidate onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
      <ErrorSummary
        items={(problem?.general ?? []).map((message) => ({ message }))}
        ref={summaryRef}
      />
      <div className="move-item-form__field">
        <Label htmlFor={selectId}>Move to</Label>
        <Select id={selectId} name="where" ref={selectRef}>
          {destinations.map((destination) => (
            <option key={destination.value} value={destination.value}>
              {destination.label}
            </option>
          ))}
        </Select>
      </div>
      <p className="move-item-form__hint">
        The item goes to the end of the place you choose. Use Move up and Move down to place it
        exactly.
      </p>
      <div className="move-item-form__buttons">
        <Button type="submit" busy={busy}>
          Move
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p role="status" className="move-item-form__status">
        {busy ? "Moving…" : null}
      </p>
    </form>
  );
}
