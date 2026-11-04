import { type ReactElement, useState } from "react";
import { useAuth } from "../../../lib/auth/session.tsx";
import { Button } from "../../atoms/Button/Button.tsx";
import { Notice } from "../../molecules/Notice/Notice.tsx";

/**
 * Shown on the login screen after a sign-out that the server could not confirm. The person is
 * signed out on this screen, but the login cookie (which the page cannot delete: it is `HttpOnly`)
 * may still be valid, so on a shared computer the next person could be signed in. The notice says
 * so and offers to try again.
 */
export function SignOutNotice(): ReactElement | null {
  const { signOutUnconfirmed, signOut } = useAuth();
  const [retrying, setRetrying] = useState(false);

  if (!signOutUnconfirmed) return null;

  const retry = async (): Promise<void> => {
    setRetrying(true);
    try {
      await signOut();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <Notice>
      <p>
        You are signed out here, but we could not confirm it with the server, so your login may
        still be active on this device. If this is a shared computer, try again or close the
        browser.
      </p>
      <Button variant="secondary" busy={retrying} onClick={retry}>
        Try signing out again
      </Button>
    </Notice>
  );
}
