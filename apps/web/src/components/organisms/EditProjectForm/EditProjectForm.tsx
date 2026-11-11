import { type ReactElement, useEffect, useRef } from "react";
import { type Project, projectsApi } from "../../../lib/api/projects-api.ts";
import { changedFields } from "../../../lib/projects/project-changes.ts";
import { useProjectForm } from "../../../lib/projects/use-project-form.ts";
import { Button } from "../../atoms/Button/Button.tsx";
import { ErrorSummary } from "../../molecules/ErrorSummary/ErrorSummary.tsx";
import { ProjectFields, projectFieldIds } from "../../molecules/ProjectFields/ProjectFields.tsx";
import "./EditProjectForm.css";

type SaveResult =
  | { readonly kind: "saved"; readonly project: Project }
  | { readonly kind: "unchanged" };

export interface EditProjectFormProps {
  /** The project as it is now. Its values fill the fields. */
  readonly project: Project;
  /** Called with the project as the API saved it. */
  readonly onSaved: (project: Project) => void;
  /** Called when Save was pressed but nothing was different. Nothing was sent. */
  readonly onUnchanged: () => void;
  readonly onCancel: () => void;
}

/**
 * The form for changing a project, shown in place of its details. It opens with the focus on the
 * title. Save sends only what changed (and nothing at all if nothing did); problems are listed at
 * the top with the focus moved there, and what was typed stays.
 */
export function EditProjectForm({
  project,
  onSaved,
  onUnchanged,
  onCancel,
}: EditProjectFormProps): ReactElement {
  const id = `edit-${project.id}`;
  const titleRef = useRef<HTMLInputElement | null>(null);

  const form = useProjectForm<SaveResult>({
    fieldIds: projectFieldIds(id),
    send: async (values) => {
      const changes = changedFields(project, values);
      if (changes === undefined) return { kind: "unchanged" };
      return { kind: "saved", project: await projectsApi.update(project.id, changes) };
    },
    onSuccess: (result) => {
      if (result.kind === "saved") onSaved(result.project);
      else onUnchanged();
    },
  });

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <form
      className="project-edit-form"
      noValidate
      aria-label={`Edit project “${project.title}”`}
      onSubmit={form.onSubmit}
    >
      <ErrorSummary items={form.summary} ref={form.summaryRef} />
      <ProjectFields
        id={id}
        defaults={{
          title: project.title,
          format: project.format,
          logline: project.logline ?? "",
        }}
        fieldError={form.fieldError}
        titleRef={titleRef}
      />
      <div className="project-edit-form__buttons">
        <Button type="submit" busy={form.busy}>
          Save changes
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p role="status" className="project-edit-form__status">
        {form.busy ? "Saving your changes…" : null}
      </p>
    </form>
  );
}
