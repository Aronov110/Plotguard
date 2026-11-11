import type { ReactElement } from "react";
import type { Project, ProjectFormat } from "../../../lib/api/projects-api.ts";
import { formatChangedDate } from "../../../lib/projects/format-changed-date.ts";
import "./ProjectSummary.css";

const FORMAT_LABELS: Readonly<Record<ProjectFormat, string>> = {
  screenplay: "Screenplay",
  prose: "Prose",
  other: "Other",
};

/**
 * What a project looks like in the list: title, format, last change and logline. Everything the
 * person wrote is shown as plain text, whatever it contains.
 */
export function ProjectSummary({ project }: { readonly project: Project }): ReactElement {
  const changed = formatChangedDate(project.updatedAt);
  const hasLogline = project.logline !== null && project.logline.trim() !== "";

  return (
    <>
      <h3 className="project-summary__title">{project.title}</h3>
      <p className="project-summary__meta">
        {FORMAT_LABELS[project.format]}
        {changed === undefined ? null : (
          <>
            {" · Changed "}
            <time dateTime={project.updatedAt}>{changed}</time>
          </>
        )}
      </p>
      {hasLogline ? <p className="project-summary__logline">{project.logline}</p> : null}
    </>
  );
}
