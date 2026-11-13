import { type ReactElement, useState } from "react";
import { Button } from "../../atoms/Button/Button.tsx";
import { Icon } from "../../atoms/Icon/Icon.tsx";
import { FormField, type FormFieldProps } from "../FormField/FormField.tsx";

export interface PasswordFieldProps
  extends Omit<FormFieldProps, "type" | "autoComplete" | "action"> {
  /**
   * Required, so that password managers know what to do: `current-password` to fill in an existing
   * password, `new-password` to offer a generated one and to save the result.
   */
  readonly autoComplete: "current-password" | "new-password";
}

/**
 * A password field with an eye button, joined to its right edge, that shows what was typed. Pasting
 * is allowed, and nothing is trimmed or changed: spaces, emoji and any language are part of the
 * password.
 */
export function PasswordField({ id, ...rest }: PasswordFieldProps): ReactElement {
  const [visible, setVisible] = useState(false);

  return (
    <FormField
      {...rest}
      id={id}
      type={visible ? "text" : "password"}
      // Once the password is shown the field is plain text, so the browser's spell checker and a
      // phone keyboard's learning could otherwise see it. These come last so a caller cannot undo them.
      spellCheck={false}
      autoCapitalize="none"
      autoCorrect="off"
      action={
        // The name stays "Show password" and `aria-pressed` carries the state: changing the name as
        // well would make a screen reader announce the state twice, and wrongly. The words are in
        // the page for screen readers; the eye is what the eye sees.
        <Button
          variant="secondary"
          aria-pressed={visible}
          aria-controls={id}
          onClick={() => {
            setVisible((current) => !current);
          }}
        >
          <Icon name={visible ? "eye-off" : "eye"} />
          <span className="visually-hidden">Show password</span>
        </Button>
      }
    />
  );
}
