import type { Project, ProjectFormat, UpdateProjectInput } from "../api/projects-api.ts";

/** What a person has typed into the project form. */
export interface ProjectFormValues {
  readonly title: string;
  readonly format: ProjectFormat;
  readonly logline: string;
}

/**
 * What to send to change `project` into what the form now says: only the fields that really
 * differ, so that saving without a change asks the API for nothing (and does not move the project
 * to the top of the list as a change would).
 *
 * - The title is compared without the spaces around it: the API trims it, so `" Act "` is `"Act"`.
 * - The logline is compared as it is. A blank one means "no logline", and is sent as `null` when
 *   the project has one (the API reads `null` and a blank text the same way).
 *
 * @returns `undefined` when nothing changed.
 */
export function changedFields(
  project: Project,
  values: ProjectFormValues,
): UpdateProjectInput | undefined {
  const changes: { title?: string; format?: ProjectFormat; logline?: string | null } = {};

  if (values.title.trim() !== project.title) changes.title = values.title;
  if (values.format !== project.format) changes.format = values.format;

  const nextLogline = values.logline.trim() === "" ? "" : values.logline;
  const currentLogline = project.logline ?? "";
  if (nextLogline !== currentLogline) changes.logline = nextLogline === "" ? null : nextLogline;

  return Object.keys(changes).length === 0 ? undefined : changes;
}
