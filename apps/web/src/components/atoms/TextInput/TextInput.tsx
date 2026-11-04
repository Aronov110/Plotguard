import type { ComponentPropsWithRef, ReactElement } from "react";
import "./TextInput.css";

export interface TextInputProps
  extends Omit<ComponentPropsWithRef<"input">, "className" | "aria-invalid"> {
  /** Required, so that a label can point to the field. */
  readonly id: string;
  /** The value is wrong. Tells assistive technology and turns the border red. */
  readonly invalid?: boolean;
}

/** A single-line field. Every attribute of `<input>` works, including `ref`. */
export function TextInput({
  invalid = false,
  type = "text",
  ...rest
}: TextInputProps): ReactElement {
  return (
    <input
      {...rest}
      type={type}
      className="text-input"
      {...(invalid ? { "aria-invalid": true } : {})}
    />
  );
}
