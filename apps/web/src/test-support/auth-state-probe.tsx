import { useAuth } from "../lib/auth/session.tsx";

/** Shows the login state as text, so a test can see what the forms did to it. */
export function AuthStateProbe() {
  const { state } = useAuth();
  return (
    <p data-testid="auth-state">
      {state.status === "signed-in" ? `signed-in:${state.user.email}` : state.status}
    </p>
  );
}
