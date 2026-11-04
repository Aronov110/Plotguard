import type { ReactElement } from "react";
import { Link, useLocation } from "react-router";
import { usePageTitle } from "../../../lib/navigation/use-page-title.ts";
import { LoginForm } from "../../organisms/LoginForm/LoginForm.tsx";
import { SignOutNotice } from "../../organisms/SignOutNotice/SignOutNotice.tsx";
import { AuthLayout } from "../../templates/AuthLayout/AuthLayout.tsx";

/** The login screen. A saved return address travels on to the sign-up screen and back. */
export function LoginPage(): ReactElement {
  usePageTitle("Log in");
  const location = useLocation();

  return (
    <AuthLayout
      title="Log in"
      footer={
        <>
          No account yet?{" "}
          {/* The saved return address travels on, so signing up instead lands in the same place. */}
          <Link to="/register" state={location.state}>
            Create one
          </Link>
        </>
      }
    >
      <SignOutNotice />
      <LoginForm />
    </AuthLayout>
  );
}
