import { type ReactElement, useEffect } from "react";
import type { ProjectsView } from "../../../lib/projects/use-projects.ts";
import { Button } from "../../atoms/Button/Button.tsx";
import { ErrorSummary } from "../../molecules/ErrorSummary/ErrorSummary.tsx";
import {
  ProjectListItem,
  projectItemId,
} from "../../molecules/ProjectListItem/ProjectListItem.tsx";
import "./ProjectList.css";

export interface ProjectListProps {
  readonly view: ProjectsView;
  /** Loads the first page again after it failed. */
  readonly onRetry: () => void;
  readonly onLoadMore: () => void;
}

/**
 * The person's projects, in the states the screen can be in: loading, failed (with a way to try
 * again), empty, and a list that can be extended one page at a time. After a page is added the
 * focus moves to its first project, so a keyboard or screen reader user continues where the new
 * ones begin, and the "Load more" button disappearing at the end never drops the focus.
 */
export function ProjectList({ view, onRetry, onLoadMore }: ProjectListProps): ReactElement {
  const justLoaded = view.status === "ready" ? view.justLoaded : undefined;

  useEffect(() => {
    if (justLoaded !== undefined)
      document.getElementById(projectItemId(justLoaded.firstId))?.focus();
  }, [justLoaded]);

  if (view.status === "loading") {
    return <p role="status">Loading your projects…</p>;
  }

  if (view.status === "failed") {
    return (
      <div className="project-list__problem">
        <ErrorSummary items={[{ message: view.message }]} />
        <Button onClick={onRetry}>Try again</Button>
      </div>
    );
  }

  const announcement =
    justLoaded === undefined
      ? ""
      : `${justLoaded.count} more ${justLoaded.count === 1 ? "project" : "projects"} loaded.`;

  return (
    <>
      {/* Always in the page, so that a screen reader is already listening when its text changes. */}
      <p role="status" className="visually-hidden">
        {view.loadingMore ? "Loading more projects…" : announcement}
      </p>
      {view.items.length === 0 ? (
        <p>You have no projects yet. Use the form above to start your first one.</p>
      ) : (
        // biome-ignore lint/a11y/noRedundantRoles: Safari drops the list meaning of a list with list-style: none
        <ul className="project-list" role="list">
          {view.items.map((project) => (
            <ProjectListItem key={project.id} project={project} />
          ))}
        </ul>
      )}
      {view.hasMore ? (
        <div className="project-list__more">
          {view.moreError === undefined ? null : (
            <ErrorSummary items={[{ message: view.moreError }]} />
          )}
          <Button variant="secondary" busy={view.loadingMore} onClick={onLoadMore}>
            Load more projects
          </Button>
        </div>
      ) : null}
    </>
  );
}
