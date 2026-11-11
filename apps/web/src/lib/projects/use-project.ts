import { useCallback, useEffect, useState } from "react";
import { ApiError, NetworkError } from "../api/problem.ts";
import { type Project, projectsApi } from "../api/projects-api.ts";
import { useAuth } from "../auth/session.tsx";
import { describeLoadError } from "../documents/document-feedback.ts";

export type ProjectLoad =
  | { readonly status: "loading" }
  | {
      readonly status: "failed";
      readonly message: string;
      /** True when the project does not exist or is not the person's: trying again cannot help. */
      readonly notFound: boolean;
    }
  | { readonly status: "ready"; readonly project: Project };

export interface UseProject {
  readonly load: ProjectLoad;
  /** Loads the project again after it failed. */
  readonly retry: () => void;
}

/**
 * Loads one project, for the heading of its writing screen. A request that is still running when
 * the screen is left (or another project is opened) is cancelled.
 */
export function useProject(projectId: string): UseProject {
  const { withAuth } = useAuth();
  const [load, setLoad] = useState<ProjectLoad>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` only counts the presses of "Try again"; changing it is what runs the load again
  useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: "loading" });
    withAuth(() => projectsApi.get(projectId, { signal: controller.signal }))
      .then((project) => {
        if (!controller.signal.aborted) setLoad({ status: "ready", project });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (!(error instanceof ApiError) && !(error instanceof NetworkError)) console.error(error);
        setLoad({
          status: "failed",
          message: describeLoadError(error, "project"),
          notFound: error instanceof ApiError && error.status === 404,
        });
      });
    return () => {
      controller.abort();
    };
  }, [projectId, attempt, withAuth]);

  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  return { load, retry };
}
