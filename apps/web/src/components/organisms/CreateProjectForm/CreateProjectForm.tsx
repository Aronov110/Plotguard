import type { ReactElement } from "react";
import type { Project, ProjectFormat } from "../../../lib/api/projects-api.ts";
import { useCreateProjectForm } from "../../../lib/projects/use-create-project-form.ts";
import { Button } from "../../atoms/Button/Button.tsx";
import { ErrorSummary } from "../../molecules/ErrorSummary/ErrorSummary.tsx";
import { FormField } from "../../molecules/FormField/FormField.tsx";
import { RadioGroupField } from "../../molecules/RadioGroupField/RadioGroupField.tsx";
import { TextAreaField } from "../../molecules/TextAreaField/TextAreaField.tsx";
import "./CreateProjectForm.css";

const FORMAT_ID = "new-project-format";
const FORMAT_OPTIONS: readonly {
  readonly value: ProjectFormat;
  readonly label: string;
  readonly hint: string;
}[] = [
  { value: "screenplay", label: "Screenplay", hint: "A film or TV script." },
  { value: "prose", label: "Prose", hint: "A novel or a story." },
  { value: "other", label: "Other", hint: "Anything else." },
];

const FIELD_IDS = {
  title: "new-project-title",
  // A problem with the format links to its first option: the group itself cannot take the focus.
  format: `${FORMAT_ID}-${FORMAT_OPTIONS[0]?.value ?? "screenplay"}`,
  logline: "new-project-logline",
} as const;

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
      <FormField
        id={FIELD_IDS.title}
        name="title"
        label="Title"
        hint="Up to 200 characters."
        autoComplete="off"
        error={form.fieldError("title")}
        ref={form.titleRef}
      />
      <RadioGroupField
        id={FORMAT_ID}
        name="format"
        legend="Format"
        options={FORMAT_OPTIONS}
        defaultValue="screenplay"
        error={form.fieldError("format")}
      />
      <TextAreaField
        id={FIELD_IDS.logline}
        name="logline"
        label="Logline"
        optional
        hint="One or two sentences about the story. Up to 1,000 characters."
        error={form.fieldError("logline")}
      />
      <Button type="submit" busy={form.busy}>
        Create project
      </Button>
      <p role="status" className="project-form__status">
        {form.busy ? "Creating your project…" : form.created}
      </p>
    </form>
  );
}
