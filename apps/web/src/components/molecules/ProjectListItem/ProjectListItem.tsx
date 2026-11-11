import type { ReactElement } from "react";
import type { Project, ProjectFormat } from "../../../lib/api/projects-api.ts";
import { formatChangedDate } from "../../../lib/projects/format-changed-date.ts";
import "./ProjectListItem.css";

const FORMAT_LABELS: Readonly<Record<ProjectFormat, string>> = {
  screenplay: "Screenplay",
  prose: "Prose",
  other: "Other",
};

/** The id of a project's list item, so that the list can move the focus to it. */
export function projectItemId(projectId: string): string {
  return `project-${projectId}`;
}

/**
 * One project in the list: title, format, last change and logline. Everything the person wrote is
 * shown as plain text, whatever it contains. The item can be focused by code (not by the tab key),
 * so that after "Load more" a screen reader starts reading at the first new project.
 */
export function ProjectListItem({ project }: { readonly project: Project }): ReactElement {
  const changed = formatChangedDate(project.updatedAt);
  const hasLogline = project.logline !== null && project.logline.trim() !== "";

  return (
    <li id={projectItemId(project.id)} className="project-item" tabIndex={-1}>
      <h3 className="project-item__title">{project.title}</h3>
      <p className="project-item__meta">
        {FORMAT_LABELS[project.format]}
        {changed === undefined ? null : (
          <>
            {" · Changed "}
            <time dateTime={project.updatedAt}>{changed}</time>
          </>
        )}
      </p>
      {hasLogline ? <p className="project-item__logline">{project.logline}</p> : null}
    </li>
  );
}
