import { type ReactElement, useEffect, useRef } from "react";
import type { Project } from "../../../lib/api/projects-api.ts";
import type { ProjectsView } from "../../../lib/projects/use-projects.ts";
import { Button } from "../../atoms/Button/Button.tsx";
import { ErrorSummary } from "../../molecules/ErrorSummary/ErrorSummary.tsx";
import { projectItemId } from "../../molecules/ProjectListItem/ProjectListItem.tsx";
import { ProjectEntry } from "../ProjectEntry/ProjectEntry.tsx";
import "./ProjectList.css";

export interface ProjectListProps {
  readonly view: ProjectsView;
  /** Loads the first page again after it failed. */
  readonly onRetry: () => void;
  readonly onLoadMore: () => void;
  /** The `id` of the heading above the list: where the focus goes when the last project is deleted. */
  readonly headingId: string;
  /** A project was saved with changes. */
  readonly onSaved: (project: Project) => void;
  /** Save was pressed with nothing changed. */
  readonly onUnchanged: () => void;
  /** A project no longer exists. */
  readonly onDeleted: (project: Project) => void;
}

/**
 * The person's projects, in the states the screen can be in: loading, failed (with a way to try
 * again), empty, and a list that can be extended one page at a time and whose projects can be
 * changed and deleted. The focus never gets lost: after a page is added it moves to the first new
 * project, and after a delete it moves to the next project, else the previous one, else the heading.
 */
export function ProjectList({
  view,
  onRetry,
  onLoadMore,
  headingId,
  onSaved,
  onUnchanged,
  onDeleted,
}: ProjectListProps): ReactElement {
  const justLoaded = view.status === "ready" ? view.justLoaded : undefined;
  const items = view.status === "ready" ? view.items : undefined;
  // The id of what gets the focus once the list has been redrawn without a deleted project.
  const focusAfterDelete = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (justLoaded !== undefined)
      document.getElementById(projectItemId(justLoaded.firstId))?.focus();
  }, [justLoaded]);

  useEffect(() => {
    if (items === undefined || focusAfterDelete.current === undefined) return;
    document.getElementById(focusAfterDelete.current)?.focus();
    focusAfterDelete.current = undefined;
  }, [items]);

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

  const handleDeleted = (project: Project): void => {
    const index = view.items.findIndex((candidate) => candidate.id === project.id);
    const neighbour = view.items[index + 1] ?? view.items[index - 1];
    focusAfterDelete.current = neighbour === undefined ? headingId : projectItemId(neighbour.id);
    onDeleted(project);
  };

  let announcement = "";
  if (view.announcement !== undefined) {
    // A screen reader says a live region again only when its text changes, so the same words twice
    // in a row get an invisible no-break space on every second time.
    announcement = view.announcement.text + (view.announcement.serial % 2 === 0 ? "\u00a0" : "");
  } else if (justLoaded !== undefined) {
    announcement = `${justLoaded.count} more ${justLoaded.count === 1 ? "project" : "projects"} loaded.`;
  }

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
            <ProjectEntry
              key={project.id}
              project={project}
              onSaved={onSaved}
              onUnchanged={onUnchanged}
              onDeleted={handleDeleted}
            />
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
