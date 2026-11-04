import type { ReactElement } from "react";
import "./InlineError.css";

export interface InlineErrorProps {
  /** Lets the field it belongs to point to it with `aria-describedby`. */
  readonly id: string;
  readonly children: string;
}

/**
 * The error message under a field. It says "Error:" in words (hidden from the eye, read by screen
 * readers) and shows a symbol, so that it does not depend on the color red alone.
 * The message is shown as plain text, whatever it contains.
 */
export function InlineError({ id, children }: InlineErrorProps): ReactElement {
  return (
    <p id={id} className="inline-error">
      <span className="inline-error__icon" aria-hidden="true">
        {"⚠︎"}
      </span>
      {/* The space is outside the span: some accessible-name algorithms drop a space at its end. */}
      <span className="visually-hidden">Error:</span> {children}
    </p>
  );
}
