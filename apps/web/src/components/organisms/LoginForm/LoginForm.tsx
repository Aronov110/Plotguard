import type { ReactElement } from "react";
import { useAuth } from "../../../lib/auth/session.tsx";
import { readText, useAuthForm } from "../../../lib/auth/use-auth-form.ts";
import { Button } from "../../atoms/Button/Button.tsx";
import { ErrorSummary } from "../../molecules/ErrorSummary/ErrorSummary.tsx";
import { FormField } from "../../molecules/FormField/FormField.tsx";
import { PasswordField } from "../../molecules/PasswordField/PasswordField.tsx";
import "../auth-form.css";

const FIELD_IDS = {
  email: "login-email",
  password: "login-password",
  displayName: "login-display-name",
} as const;

/**
 * The login form. When it succeeds, nothing here moves the person on: the login state changes, and
 * the guard around the login screen (`RedirectIfSignedIn`) sends them to where they were going.
 */
export function LoginForm(): ReactElement {
  const { login } = useAuth();
  const form = useAuthForm({
    form: "login",
    fieldIds: FIELD_IDS,
    // The email loses the spaces a paste often brings along. The password is never touched.
    read: (data) => ({
      email: readText(data, "email").trim(),
      password: readText(data, "password"),
    }),
    send: (values) => login(values),
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
        autoComplete="username"
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
        autoComplete="current-password"
        error={form.fieldError("password")}
      />
      <Button type="submit" busy={form.busy}>
        Log in
      </Button>
      <p role="status" className="auth-form__status">
        {form.busy ? "Signing you in…" : null}
      </p>
    </form>
  );
}
