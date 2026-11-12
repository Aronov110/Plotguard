import type { ComponentPropsWithRef, ReactElement } from "react";
import "./Select.css";

export interface SelectProps
  extends Omit<ComponentPropsWithRef<"select">, "className" | "aria-invalid"> {
  /** Required, so that a label can point to the field. */
  readonly id: string;
  /** The choice is wrong. Tells assistive technology and turns the border red. */
  readonly invalid?: boolean;
}

/**
 * A drop-down list of choices, the browser's own: it works with the keyboard, on phones and with
 * screen readers without any extra code. Put `<option>`s inside it. Every attribute of `<select>`
 * works, including `ref`.
 */
export function Select({ invalid = false, ...rest }: SelectProps): ReactElement {
  return <select {...rest} className="select" {...(invalid ? { "aria-invalid": true } : {})} />;
}
