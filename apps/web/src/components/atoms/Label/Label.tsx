import type { ReactElement, ReactNode } from "react";
import "./Label.css";

export interface LabelProps {
  /** The `id` of the field this label names. Clicking the label moves the focus there. */
  readonly htmlFor: string;
  /** Adds "(optional)" in words. Required fields get no marker; optional ones are the exception. */
  readonly optional?: boolean;
  readonly children: ReactNode;
}

/** The visible name of a form field. */
export function Label({ htmlFor, optional = false, children }: LabelProps): ReactElement {
  return (
    <label className="label" htmlFor={htmlFor}>
      {children}
      {/* The space is outside the span: some accessible-name algorithms drop a space at its start. */}
      {optional ? " " : null}
      {optional ? <span className="label__optional">(optional)</span> : null}
    </label>
  );
}
