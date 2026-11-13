import type { ReactElement, ReactNode } from "react";
import { Icon, type IconName } from "../../atoms/Icon/Icon.tsx";
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
  /** A small picture inside the left edge of the field. It only decorates: the label names the field. */
  readonly icon?: IconName;
  /**
   * An extra control joined to the right edge of the field, for example a "show password" button. It
   * sits outside the field's own box, so a password manager's icon, which is drawn inside the field,
   * cannot cover it.
   */
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
  icon,
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
      <div className="form-field__control" data-joined={action === undefined ? undefined : "true"}>
        <div className="form-field__box" data-icon={icon === undefined ? undefined : "true"}>
          {icon === undefined ? null : (
            <span className="form-field__icon">
              <Icon name={icon} />
            </span>
          )}
          <TextInput
            {...inputProps}
            id={id}
            invalid={hasError}
            {...(describedBy === "" ? {} : { "aria-describedby": describedBy })}
          />
        </div>
        {action}
      </div>
      {hasError ? <InlineError id={errorId}>{error}</InlineError> : null}
    </div>
  );
}
