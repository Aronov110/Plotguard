import type { ComponentPropsWithRef, ReactElement } from "react";
import "../TextInput/TextInput.css";

export interface TextAreaProps
  extends Omit<ComponentPropsWithRef<"textarea">, "className" | "aria-invalid"> {
  /** Required, so that a label can point to the field. */
  readonly id: string;
  /** The value is wrong. Tells assistive technology and turns the border red. */
  readonly invalid?: boolean;
}

/** A multi-line field. Every attribute of `<textarea>` works, including `ref`. */
export function TextArea({ invalid = false, rows = 4, ...rest }: TextAreaProps): ReactElement {
  return (
    <textarea
      {...rest}
      rows={rows}
      className="text-area"
      {...(invalid ? { "aria-invalid": true } : {})}
    />
  );
}
