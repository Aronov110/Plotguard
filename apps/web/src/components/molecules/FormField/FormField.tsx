import type { ReactElement, ReactNode } from "react";
import { InlineError } from "../../atoms/InlineError/InlineError.tsx";
import { Label } from "../../atoms/Label/Label.tsx";
import { TextInput, type TextInputProps } from "../../atoms/TextInput/TextInput.tsx";
import "./FormField.css";

export interface FormFieldProps extends Omit<TextInputProps, "invalid" | "aria-describedby"> {
  /** The visible name of the field. */
  readonly label: string;
  /** Help shown before the person types, for example the length a password needs. */
  readonly hint?: string | undefined;
  /** What is wrong with the value. An empty string counts as no error. */
  readonly error?: string | undefined;
  /** Adds "(optional)" to the label. Required fields get no marker. */
  readonly optional?: boolean;
  /** An extra control beside the field, for example a "show password" button. */
  readonly action?: ReactNode;
}

/**
 * A labelled field with an optional hint and error. The label, hint and error are tied to the
 * input (`for`, `aria-describedby`, `aria-invalid`), so a screen reader reads them with the field.
 */
export function FormField({
  id,
  label,
  hint,
  error,
  optional = false,
  action,
  ...inputProps
}: FormFieldProps): ReactElement {
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
      <div className="form-field__control">
        <TextInput
          {...inputProps}
          id={id}
          invalid={hasError}
          {...(describedBy === "" ? {} : { "aria-describedby": describedBy })}
        />
        {action}
      </div>
      {hasError ? <InlineError id={errorId}>{error}</InlineError> : null}
    </div>
  );
}
