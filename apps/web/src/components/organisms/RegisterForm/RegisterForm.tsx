import type { ReactElement } from "react";
import { useAuth } from "../../../lib/auth/session.tsx";
import { readText, useAuthForm } from "../../../lib/auth/use-auth-form.ts";
import { Button } from "../../atoms/Button/Button.tsx";
import { ErrorSummary } from "../../molecules/ErrorSummary/ErrorSummary.tsx";
import { FormField } from "../../molecules/FormField/FormField.tsx";
import { PasswordField } from "../../molecules/PasswordField/PasswordField.tsx";
import "../auth-form.css";

const FIELD_IDS = {
  email: "register-email",
  password: "register-password",
  displayName: "register-display-name",
} as const;

/**
 * The sign-up form. Like the login form it leaves moving on to the guard around the screen. It
 * checks only that the email and the password are filled in: whether they are good enough (a valid
 * address, a long enough password) is the API's rule, and its messages are shown as they come.
 */
export function RegisterForm(): ReactElement {
  const { register } = useAuth();
  const form = useAuthForm({
    form: "register",
    fieldIds: FIELD_IDS,
    read: (data) => ({
      email: readText(data, "email").trim(),
      password: readText(data, "password"),
      displayName: readText(data, "displayName").trim(),
    }),
    send: ({ email, password, displayName }) =>
      register({ email, password, ...(displayName === "" ? {} : { displayName }) }),
  });

  return (
    <form className="auth-form" noValidate onSubmit={form.onSubmit}>
      <ErrorSummary items={form.summary} ref={form.summaryRef} />
      <FormField
        id={FIELD_IDS.email}
        name="email"
        label="Email"
        icon="mail"
        type="email"
        autoComplete="email"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        error={form.fieldError("email")}
      />
      <PasswordField
        id={FIELD_IDS.password}
        name="password"
        label="Password"
        icon="lock"
        autoComplete="new-password"
        hint="12 to 128 characters. Spaces and any language are allowed."
        error={form.fieldError("password")}
      />
      <FormField
        id={FIELD_IDS.displayName}
        name="displayName"
        label="Display name"
        icon="user"
        optional
        autoComplete="nickname"
        hint="Up to 80 characters."
        error={form.fieldError("displayName")}
      />
      <Button type="submit" busy={form.busy}>
        Create account
      </Button>
      <p role="status" className="auth-form__status">
        {form.busy ? "Creating your account…" : null}
      </p>
    </form>
  );
}
