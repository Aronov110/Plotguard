import type { ReactElement, ReactNode } from "react";
import { Icon } from "../../atoms/Icon/Icon.tsx";
import "./ChoiceOption.css";

export interface ChoiceOptionProps {
  /** The id of the radio button. The hint's id is built from it (`<id>-hint`). */
  readonly id: string;
  /** The group the option belongs to: radio buttons with the same name are one choice. */
  readonly name: string;
  readonly value: string;
  /** What the person reads. It can hold text they wrote (a title), so it is shown as text only. */
  readonly label: ReactNode;
  /** A short explanation, read out with the option. */
  readonly hint?: ReactNode;
  /** For a controlled choice: whether this option is the chosen one. */
  readonly checked?: boolean;
  /** For a choice that a form reads when it is sent: whether this option is chosen at the start. */
  readonly defaultChecked?: boolean;
  readonly disabled?: boolean;
  readonly onChange?: () => void;
  /** Extra things that describe the option, read with its hint (an id, or ids with spaces). */
  readonly describedBy?: string;
}

/**
 * One choice among a few, drawn as a card: a ring that fills with a tick when chosen, the label, and
 * an optional hint. The radio button is the real control and covers the whole card, so a press
 * anywhere on it chooses it, and the arrow keys, the group and a form's reset all work as they do for
 * any radio buttons. The chosen card is tinted, has an accent edge, a tick and a heavier label: it is
 * never told apart by colour alone.
 */
export function ChoiceOption({
  id,
  name,
  value,
  label,
  hint,
  checked,
  defaultChecked,
  disabled = false,
  onChange,
  describedBy,
}: ChoiceOptionProps): ReactElement {
  const hintId = `${id}-hint`;
  const hasHint = hint !== undefined && hint !== null && hint !== "";
  const described = [hasHint ? hintId : undefined, describedBy]
    .filter((part) => part !== undefined && part !== "")
    .join(" ");

  return (
    <div className="choice-option" data-disabled={disabled ? "true" : undefined}>
      <input
        id={id}
        className="choice-option__input"
        type="radio"
        name={name}
        value={value}
        disabled={disabled}
        {...(checked === undefined ? {} : { checked })}
        {...(defaultChecked === undefined ? {} : { defaultChecked })}
        {...(onChange === undefined ? {} : { onChange })}
        {...(described === "" ? {} : { "aria-describedby": described })}
      />
      <span className="choice-option__tick" aria-hidden="true">
        <Icon name="check" />
      </span>
      <div className="choice-option__body">
        <label htmlFor={id} className="choice-option__label">
          {label}
        </label>
        {hasHint ? (
          <p id={hintId} className="choice-option__hint">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
