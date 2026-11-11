import type { ReactElement } from "react";
import type { Project } from "../../../lib/api/projects-api.ts";
import { useCreateProjectForm } from "../../../lib/projects/use-create-project-form.ts";
import { Button } from "../../atoms/Button/Button.tsx";
import { ErrorSummary } from "../../molecules/ErrorSummary/ErrorSummary.tsx";
import { ProjectFields, projectFieldIds } from "../../molecules/ProjectFields/ProjectFields.tsx";
import "./CreateProjectForm.css";

const ID = "new-project";
const FIELD_IDS = projectFieldIds(ID);

export interface CreateProjectFormProps {
  /** Called with the new project once the API has created it. */
  readonly onCreated: (project: Project) => void;
}

/**
 * The form for a new project. When it succeeds the fields are emptied, the focus returns to the
 * title so that the next project can be typed at once, and a message says what was created.
 */
export function CreateProjectForm({ onCreated }: CreateProjectFormProps): ReactElement {
  const form = useCreateProjectForm({ fieldIds: FIELD_IDS, onCreated });

  return (
    <form className="project-form" noValidate onSubmit={form.onSubmit}>
      <ErrorSummary items={form.summary} ref={form.summaryRef} />
      <ProjectFields id={ID} fieldError={form.fieldError} titleRef={form.titleRef} />
      <Button type="submit" busy={form.busy}>
        Create project
      </Button>
      <p role="status" className="project-form__status">
        {form.busy ? "Creating your project…" : form.created}
      </p>
    </form>
  );
}
