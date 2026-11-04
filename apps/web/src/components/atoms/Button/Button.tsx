import type { ComponentPropsWithoutRef, MouseEvent, ReactElement } from "react";
import "./Button.css";

export interface ButtonProps extends Omit<ComponentPropsWithoutRef<"button">, "className"> {
  /** `primary` is the main action of a screen; `secondary` is for anything else. */
  readonly variant?: "primary" | "secondary";
  /**
   * The action is running. The button keeps its label and its place in the tab order (so a keyboard
   * user does not lose their spot) but ignores presses, which stops a double click from sending
   * the same request twice.
   */
  readonly busy?: boolean;
}

/** A button. It does not submit a form unless `type="submit"` is given. */
export function Button({
  variant = "primary",
  busy = false,
  type = "button",
  onClick,
  ...rest
}: ButtonProps): ReactElement {
  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (busy) {
      // Also stops a busy submit button from submitting its form.
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <button
      {...rest}
      type={type}
      className={`button button--${variant}`}
      onClick={handleClick}
      {...(busy ? { "aria-busy": true, "aria-disabled": true } : {})}
    />
  );
}
