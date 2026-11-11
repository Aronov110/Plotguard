import type { ReactElement, ReactNode } from "react";
import "./ProjectListItem.css";

/** The id of a project's list item, so that the list can move the focus to it. */
export function projectItemId(projectId: string): string {
  return `project-${projectId}`;
}

export interface ProjectListItemProps {
  readonly projectId: string;
  /** What the card shows: the project's details, a form, a question. */
  readonly children: ReactNode;
}

/**
 * The frame of one project in the list: a card that holds whatever the project is showing right
 * now. The card can be focused by code (not by the tab key), so that after "Load more" or a
 * delete a screen reader starts reading at the right project.
 */
export function ProjectListItem({ projectId, children }: ProjectListItemProps): ReactElement {
  return (
    <li id={projectItemId(projectId)} className="project-item" tabIndex={-1}>
      {children}
    </li>
  );
}
