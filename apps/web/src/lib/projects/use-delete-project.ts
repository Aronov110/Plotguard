import { useCallback, useRef, useState } from "react";
import { ApiError, NetworkError } from "../api/problem.ts";
import { projectsApi } from "../api/projects-api.ts";
import { useAuth } from "../auth/session.tsx";
import { describeDeleteError } from "./project-form-feedback.ts";

export interface UseDeleteProject {
  /** True while the request is running. */
  readonly busy: boolean;
  /** Why the last attempt failed, in words; `undefined` when there is nothing to say. */
  readonly error: string | undefined;
  /** Deletes the project. Does nothing while a request is already running. */
  readonly confirm: () => void;
  /** Forgets the last error, for example when the person decides to keep the project. */
  readonly forgetError: () => void;
}

/**
 * Deletes one project and tells the caller when it is gone. A 404 counts as gone too: the person
 * wanted the project deleted, and it is (for example, it was deleted in another tab).
 *
 * @param onDeleted Called once, when the project no longer exists.
 */
export function useDeleteProject(projectId: string, onDeleted: () => void): UseDeleteProject {
  const { withAuth } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  // A ref as well as state: two presses in a row can arrive before React has re-rendered the button.
  const running = useRef(false);

  const confirm = useCallback(() => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(undefined);
    withAuth(() => projectsApi.remove(projectId))
      .then(onDeleted)
      .catch((failure: unknown) => {
        if (failure instanceof ApiError && failure.status === 404) {
          onDeleted();
          return;
        }
        // Anything but a refused request or a missing connection is a bug or a changed API: the
        // person sees a general message, and the cause goes to the console.
        if (!(failure instanceof ApiError) && !(failure instanceof NetworkError)) {
          console.error(failure);
        }
        setError(describeDeleteError(failure));
      })
      .finally(() => {
        running.current = false;
        setBusy(false);
      });
  }, [projectId, onDeleted, withAuth]);

  const forgetError = useCallback(() => {
    setError(undefined);
  }, []);

  return { busy, error, confirm, forgetError };
}
