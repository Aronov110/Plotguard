import type { ReactElement } from "react";
import { Link, useLocation } from "react-router";
import { usePageTitle } from "../../../lib/navigation/use-page-title.ts";
import { RegisterForm } from "../../organisms/RegisterForm/RegisterForm.tsx";
import { AuthLayout } from "../../templates/AuthLayout/AuthLayout.tsx";

/** The sign-up screen. A saved return address travels on to the login screen and back. */
export function RegisterPage(): ReactElement {
  usePageTitle("Create your account");
  const location = useLocation();

  return (
    <AuthLayout
      title="Create your account"
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" state={location.state}>
            Log in
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthLayout>
  );
}
