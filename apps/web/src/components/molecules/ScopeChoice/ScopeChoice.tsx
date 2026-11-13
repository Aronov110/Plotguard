import { type ReactElement, useId } from "react";
import { ChoiceOption } from "../ChoiceOption/ChoiceOption.tsx";
import "./ScopeChoice.css";

export type ScopeValue = "item" | "project";

export interface ScopeChoiceProps {
  readonly value: ScopeValue;
  readonly onChange: (value: ScopeValue) => void;
  /** The title of the item that is open, or `undefined` when none is. */
  readonly itemTitle: string | undefined;
  /** A run is going: the choice is shown but cannot be changed. */
  readonly disabled: boolean;
}

/**
 * Chooses what the AI reads: the item that is open (an act with its scenes, or a scene), or the
 * whole project. Two cards that are real radio buttons. The first is not available while no item is
 * open, and says why. The arrow keys move the choice, as the browser does for radio buttons with the
 * same name.
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
      <ChoiceOption
        id={`${id}-item`}
        name={`${id}-scope`}
        value="item"
        label={noItem ? "The open item" : `The open item: “${itemTitle}”`}
        hint={noItem ? "Open an item in the outline to choose this." : undefined}
        checked={value === "item"}
        disabled={noItem}
        onChange={() => {
          onChange("item");
        }}
      />
      <ChoiceOption
        id={`${id}-project`}
        name={`${id}-scope`}
        value="project"
        label="The whole project"
        checked={value === "project"}
        onChange={() => {
          onChange("project");
        }}
      />
    </fieldset>
  );
}
