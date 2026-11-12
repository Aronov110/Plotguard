import { type ReactElement, useId } from "react";
import "./ScopeChoice.css";

export type ScopeValue = "item" | "project";

export interface ScopeChoiceProps {
  readonly value: ScopeValue;
  readonly onChange: (value: ScopeValue) => void;
  /** The title of the item that is open, or `undefined` when none is. */
  readonly itemTitle: string | undefined;
  /** A scan is going: the choice is shown but cannot be changed. */
  readonly disabled: boolean;
}

/**
 * Chooses what a scan reads: the item that is open (an act with its scenes, or a scene), or the
 * whole project. The first is not available while no item is open, and says why. The arrow keys
 * move the choice, as the browser does for radio buttons with the same name.
 */
export function ScopeChoice({
  value,
  onChange,
  itemTitle,
  disabled,
}: ScopeChoiceProps): ReactElement {
  const id = useId();
  const noItem = itemTitle === undefined;
  return (
    <fieldset className="scope-choice" disabled={disabled}>
      <legend className="scope-choice__legend">What should it read?</legend>
      <div className="scope-choice__option">
        <input
          id={`${id}-item`}
          className="scope-choice__input"
          type="radio"
          name={`${id}-scope`}
          value="item"
          checked={value === "item"}
          disabled={noItem}
          onChange={() => {
            onChange("item");
          }}
          {...(noItem ? { "aria-describedby": `${id}-item-hint` } : {})}
        />
        <div>
          <label htmlFor={`${id}-item`} className="scope-choice__label">
            {noItem ? "The open item" : `The open item: “${itemTitle}”`}
          </label>
          {noItem ? (
            <p id={`${id}-item-hint`} className="scope-choice__hint">
              Open an item in the outline to choose this.
            </p>
          ) : null}
        </div>
      </div>
      <div className="scope-choice__option">
        <input
          id={`${id}-project`}
          className="scope-choice__input"
          type="radio"
          name={`${id}-scope`}
          value="project"
          checked={value === "project"}
          onChange={() => {
            onChange("project");
          }}
        />
        <div>
          <label htmlFor={`${id}-project`} className="scope-choice__label">
            The whole project
          </label>
        </div>
      </div>
    </fieldset>
  );
}
