import type { ReactElement } from "react";
import { InlineError } from "../../atoms/InlineError/InlineError.tsx";
import { Label } from "../../atoms/Label/Label.tsx";
import { TextArea, type TextAreaProps } from "../../atoms/TextArea/TextArea.tsx";
// The spacing and the hint style are the same as for a one-line field.
import "../FormField/FormField.css";

export interface TextAreaFieldProps extends Omit<TextAreaProps, "invalid" | "aria-describedby"> {
  /** The visible name of the field. */
  readonly label: string;
  /** Help shown before the person types, for example how long the text may be. */
  readonly hint?: string | undefined;
  /** What is wrong with the value. An empty string counts as no error. */
  readonly error?: string | undefined;
  /** Adds "(optional)" to the label. Required fields get no marker. */
  readonly optional?: boolean;
}

/**
 * A labelled multi-line field with an optional hint and error. The label, hint and error are tied
 * to the field (`for`, `aria-describedby`, `aria-invalid`), so a screen reader reads them with it.
 */
export function TextAreaField({
  id,
  label,
  hint,
  error,
  optional = false,
  ...areaProps
}: TextAreaFieldProps): ReactElement {
  const hasHint = hint !== undefined && hint !== "";
  const hasError = error !== undefined && error !== "";
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hasHint ? hintId : undefined, hasError ? errorId : undefined]
    .filter((part) => part !== undefined)
    .join(" ");

  return (
    <div className="form-field">
      <Label htmlFor={id} optional={optional}>
        {label}
      </Label>
      {hasHint ? (
        <p id={hintId} className="form-field__hint">
          {hint}
        </p>
      ) : null}
      <TextArea
        {...areaProps}
        id={id}
        invalid={hasError}
        {...(describedBy === "" ? {} : { "aria-describedby": describedBy })}
      />
      {hasError ? <InlineError id={errorId}>{error}</InlineError> : null}
    </div>
  );
}
