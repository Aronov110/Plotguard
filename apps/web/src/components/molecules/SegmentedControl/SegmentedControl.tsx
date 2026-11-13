import { type CSSProperties, type ReactElement, useId } from "react";
import { Icon, type IconName } from "../../atoms/Icon/Icon.tsx";
import "./SegmentedControl.css";

export interface SegmentedOption<T extends string> {
  /** What `onChange` gets. */
  readonly value: T;
  /** What the person reads. */
  readonly label: string;
  /** A small picture before the label. It only decorates: the label says what it means. */
  readonly icon?: IconName;
  /** A sentence under the control while this option is chosen, read out with the group. */
  readonly hint?: string;
}

export interface SegmentedControlProps<T extends string> {
  /** The question or name of the choice. A screen reader reads it with every option. */
  readonly legend: string;
  /** Hide the legend from the eye (it stays for screen readers) when something else already asks. */
  readonly hideLegend?: boolean;
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  /** The choice is shown but cannot be changed. */
  readonly disabled?: boolean;
}

/**
 * A choice of a few, laid out in a row, with a marker that slides to the chosen one. Underneath they
 * are ordinary radio buttons in a group: the arrow keys move the choice, a screen reader announces a
 * group with its question, and each option is at least 44 px tall. The chosen one is marked by an
 * outline and a heavier label, not by colour alone. The slide stops for people who ask for less motion.
 * The chosen option's `hint`, if it has one, is shown under the control and tied to the group.
 */
export function SegmentedControl<T extends string>({
  legend,
  hideLegend = false,
  options,
  value,
  onChange,
  disabled = false,
}: SegmentedControlProps<T>): ReactElement {
  const name = useId();
  const hintId = `${name}-hint`;
  const index = options.findIndex((option) => option.value === value);
  const hint = options[index]?.hint;
  // A value that is not among the options leaves nothing marked, instead of marking the first.
  const style = { "--count": options.length, "--index": Math.max(index, 0) } as CSSProperties;

  return (
    <fieldset
      className="segmented"
      disabled={disabled}
      {...(hint === undefined ? {} : { "aria-describedby": hintId })}
    >
      <legend className={hideLegend ? "visually-hidden" : "segmented__legend"}>{legend}</legend>
      <div
        className="segmented__track"
        style={style}
        data-empty={index === -1 ? "true" : undefined}
      >
        <span className="segmented__thumb" aria-hidden="true" />
        {options.map((option) => (
          <label key={option.value} className="segmented__option">
            <input
              className="segmented__input"
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => {
                onChange(option.value);
              }}
            />
            {option.icon === undefined ? null : <Icon name={option.icon} />}
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {hint === undefined ? null : (
        <p id={hintId} className="segmented__hint">
          {hint}
        </p>
      )}
    </fieldset>
  );
}
