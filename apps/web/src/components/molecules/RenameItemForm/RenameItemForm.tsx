import {
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  useEffect,
  useId,
  useRef,
} from "react";
import { readText } from "../../../lib/auth/use-auth-form.ts";
import type { ItemActionProblem } from "../../../lib/documents/document-feedback.ts";
import { Button } from "../../atoms/Button/Button.tsx";
import { ErrorSummary } from "../ErrorSummary/ErrorSummary.tsx";
import { FormField } from "../FormField/FormField.tsx";
import "./RenameItemForm.css";

export interface RenameItemFormProps {
  /** The title the item has now. It fills the field, selected, so that typing replaces it. */
  readonly currentTitle: string;
  /** The rename is running. */
  readonly busy: boolean;
  /** Why the last attempt failed, in words. A new object for every failure. */
  readonly problem: ItemActionProblem | undefined;
  /** Called with the title as typed. The caller checks it and sends it. */
  readonly onSave: (title: string) => void;
  /** Close the form and change nothing. Also called by the Escape key. */
  readonly onCancel: () => void;
}

/**
 * The small form that renames an item, shown in place of the toolbar's buttons. It opens with the
 * focus in the title field and the title selected. A problem is listed at the top with the focus
 * moved there, and what was typed stays. Escape closes it. It has no name of its own: it would become a
 * landmark, and a small form inside the toolbar's group does not need to be one.
 */
export function RenameItemForm({
  currentTitle,
  busy,
  problem,
  onSave,
  onCancel,
}: RenameItemFormProps): ReactElement {
  const fieldId = `${useId()}-title`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Each failed attempt sets a new problem object, so the focus moves again for the same words.
  useEffect(() => {
    if (problem !== undefined) summaryRef.current?.focus();
  }, [problem]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSave(readText(new FormData(event.currentTarget), "title"));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>): void => {
    if (event.key === "Escape" && !busy) {
      event.stopPropagation();
      onCancel();
    }
  };

  const summary =
    problem === undefined
      ? []
      : [
          ...(problem.title === undefined ? [] : [{ message: problem.title, fieldId }]),
          ...problem.general.map((message) => ({ message })),
        ];

  return (
    <form className="rename-item-form" noValidate onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
      <ErrorSummary items={summary} ref={summaryRef} />
      <FormField
        id={fieldId}
        name="title"
        label="New title"
        defaultValue={currentTitle}
        autoComplete="off"
        error={problem?.title}
        ref={inputRef}
      />
      <div className="rename-item-form__buttons">
        <Button type="submit" busy={busy}>
          Save title
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p role="status" className="rename-item-form__status">
        {busy ? "Renaming…" : null}
      </p>
    </form>
  );
}
