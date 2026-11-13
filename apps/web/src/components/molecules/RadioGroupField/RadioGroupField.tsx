import type { ReactElement } from "react";
import { InlineError } from "../../atoms/InlineError/InlineError.tsx";
import { ChoiceOption } from "../ChoiceOption/ChoiceOption.tsx";
import "./RadioGroupField.css";

export interface RadioOption {
  /** What the form sends. */
  readonly value: string;
  /** What the person reads. */
  readonly label: string;
  /** A short explanation read with the option. */
  readonly hint?: string;
}

export interface RadioGroupFieldProps {
  /** Builds the ids of the options (`<id>-<value>`), the hint and the error. */
  readonly id: string;
  /** The form field name. */
  readonly name: string;
  /** The question. A screen reader reads it with every option. */
  readonly legend: string;
  readonly options: readonly RadioOption[];
  /** The option that is chosen at the start, and again after the form is reset. */
  readonly defaultValue: string;
  readonly hint?: string | undefined;
  /** What is wrong. An empty string counts as no error. */
  readonly error?: string | undefined;
}

/**
 * A choice of one out of a few, as a group of cards (radio buttons) under a question. The arrow keys move
 * the choice (the browser does that for radio buttons with the same name). Uncontrolled: the form
 * reads the choice when it is sent.
 */
export function RadioGroupField({
  id,
  name,
  legend,
  options,
  defaultValue,
  hint,
  error,
}: RadioGroupFieldProps): ReactElement {
  const hasHint = hint !== undefined && hint !== "";
  const hasError = error !== undefined && error !== "";
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hasHint ? hintId : undefined, hasError ? errorId : undefined]
    .filter((part) => part !== undefined)
    .join(" ");

  return (
    <fieldset
      className="radio-group"
      {...(describedBy === "" ? {} : { "aria-describedby": describedBy })}
    >
      <legend className="radio-group__legend">{legend}</legend>
      {hasHint ? (
        <p id={hintId} className="radio-group__hint">
          {hint}
        </p>
      ) : null}
      {options.map((option) => (
        <ChoiceOption
          key={option.value}
          id={`${id}-${option.value}`}
          name={name}
          value={option.value}
          label={option.label}
          hint={option.hint}
          defaultChecked={option.value === defaultValue}
        />
      ))}
      {hasError ? <InlineError id={errorId}>{error}</InlineError> : null}
    </fieldset>
  );
}
