import type { ChangeEvent, ReactElement } from "react";
import {
  countFocus,
  FOCUS_INPUT_CEILING,
  FOCUS_MAX_CHARACTERS,
} from "../../../lib/analyses/focus.ts";
import { TextAreaField } from "../TextAreaField/TextAreaField.tsx";

export interface FocusFieldProps {
  /** Builds the ids of the hint and the error, and ties the label to the field. */
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** A run is going: the text is shown but cannot be changed. */
  readonly disabled: boolean;
}

/**
 * What the ideas should be about: an optional free text of at most 500 characters. The count is the
 * server's count (the text with its spaces tidied, an emoji as one character), shown in the hint, so
 * that it is read with the field and does not chatter on every key. A text that is too long is an
 * error tied to the field and said once to a screen reader when it first goes over. The text is kept
 * after a run, so that it can be adjusted for the next one.
 */
export function FocusField({ id, value, onChange, disabled }: FocusFieldProps): ReactElement {
  const count = countFocus(value);
  const over = count - FOCUS_MAX_CHARACTERS;
  return (
    <>
      <TextAreaField
        id={id}
        label="What should the ideas be about?"
        optional
        rows={3}
        hint={`For example: a stronger ending, or what the stranger on the pier wants. Line breaks become spaces. ${count} of ${FOCUS_MAX_CHARACTERS} characters.`}
        error={
          over > 0
            ? `The focus is ${over} ${over === 1 ? "character" : "characters"} too long. It can be at most ${FOCUS_MAX_CHARACTERS}.`
            : undefined
        }
        value={value}
        maxLength={FOCUS_INPUT_CEILING}
        disabled={disabled}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
          onChange(event.target.value);
        }}
      />
      {/* Always in the page, so that a screen reader is already listening when it fills. The text
          does not change with the count, so it is said once and not on every key. */}
      <p role="status" className="visually-hidden">
        {over > 0 ? "The focus is too long." : ""}
      </p>
    </>
  );
}
