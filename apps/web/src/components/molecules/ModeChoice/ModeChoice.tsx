import { type ReactElement, useId } from "react";
import type { AnalysisKind } from "../../../lib/api/analyses-api.ts";
import "./ModeChoice.css";

export interface ModeChoiceProps {
  readonly value: AnalysisKind;
  readonly onChange: (value: AnalysisKind) => void;
  /** A run is going: the choice is shown but cannot be changed. */
  readonly disabled: boolean;
}

const OPTIONS: readonly {
  readonly value: AnalysisKind;
  readonly label: string;
  readonly hint: string;
}[] = [
  {
    value: "plot_holes",
    label: "Find plot holes",
    hint: "Points out where the story contradicts itself or leaves something unexplained.",
  },
  {
    value: "ideas",
    label: "Get ideas",
    hint: "Suggests where the story could go next. They are suggestions, not corrections.",
  },
];

/**
 * Chooses what the AI does with the text: find plot holes, or suggest ideas. Two radio buttons in a
 * group with a question, each with a hint that is read with it. The arrow keys move the choice, as
 * the browser does for radio buttons with the same name.
 */
export function ModeChoice({ value, onChange, disabled }: ModeChoiceProps): ReactElement {
  const id = useId();
  return (
    <fieldset className="mode-choice" disabled={disabled}>
      <legend className="mode-choice__legend">What do you want?</legend>
      {OPTIONS.map((option) => (
        <div key={option.value} className="mode-choice__option">
          <input
            id={`${id}-${option.value}`}
            className="mode-choice__input"
            type="radio"
            name={`${id}-mode`}
            value={option.value}
            checked={value === option.value}
            aria-describedby={`${id}-${option.value}-hint`}
            onChange={() => {
              onChange(option.value);
            }}
          />
          <div>
            <label htmlFor={`${id}-${option.value}`} className="mode-choice__label">
              {option.label}
            </label>
            <p id={`${id}-${option.value}-hint`} className="mode-choice__hint">
              {option.hint}
            </p>
          </div>
        </div>
      ))}
    </fieldset>
  );
}
