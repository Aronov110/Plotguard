import type { ReactElement, Ref } from "react";
import type { ProjectFormat } from "../../../lib/api/projects-api.ts";
import type { ProjectFormValues } from "../../../lib/projects/project-changes.ts";
import type { ProjectFieldName } from "../../../lib/projects/project-form-feedback.ts";
import { FormField } from "../FormField/FormField.tsx";
import { RadioGroupField } from "../RadioGroupField/RadioGroupField.tsx";
import { TextAreaField } from "../TextAreaField/TextAreaField.tsx";

const FORMAT_OPTIONS: readonly {
  readonly value: ProjectFormat;
  readonly label: string;
  readonly hint: string;
}[] = [
  { value: "screenplay", label: "Screenplay", hint: "A film or TV script." },
  { value: "prose", label: "Prose", hint: "A novel or a story." },
  { value: "other", label: "Other", hint: "Anything else." },
];

/** What the fields hold in a form for a new project. */
const EMPTY: ProjectFormValues = { title: "", format: "screenplay", logline: "" };

/**
 * The ids of the three fields for a given `id`, so that a form can link its problem list to them.
 * A problem with the format links to its first option: the group itself cannot take the focus.
 */
export function projectFieldIds(id: string): Readonly<Record<ProjectFieldName, string>> {
  return {
    title: `${id}-title`,
    format: `${id}-format-${FORMAT_OPTIONS[0]?.value ?? "screenplay"}`,
    logline: `${id}-logline`,
  };
}

export interface ProjectFieldsProps {
  /** Builds every id in the fields. Must be different for each form on the page. */
  readonly id: string;
  /** What the fields hold at the start, and again after the form is reset. Empty by default. */
  readonly defaults?: ProjectFormValues;
  /** The message to show under one field, if any. */
  readonly fieldError: (field: ProjectFieldName) => string | undefined;
  /** Attach to the title field, so the form can move the focus there. */
  readonly titleRef?: Ref<HTMLInputElement>;
}

/**
 * The three fields of a project: title, format and logline. The new-project form and the
 * edit-project form both use them, so the labels, hints and rules read the same in both.
 */
export function ProjectFields({
  id,
  defaults = EMPTY,
  fieldError,
  titleRef,
}: ProjectFieldsProps): ReactElement {
  const ids = projectFieldIds(id);

  return (
    <>
      <FormField
        id={ids.title}
        name="title"
        label="Title"
        hint="Up to 200 characters."
        autoComplete="off"
        defaultValue={defaults.title}
        error={fieldError("title")}
        {...(titleRef === undefined ? {} : { ref: titleRef })}
      />
      <RadioGroupField
        id={`${id}-format`}
        name="format"
        legend="Format"
        options={FORMAT_OPTIONS}
        defaultValue={defaults.format}
        error={fieldError("format")}
      />
      <TextAreaField
        id={ids.logline}
        name="logline"
        label="Logline"
        optional
        hint="One or two sentences about the story. Up to 1,000 characters."
        defaultValue={defaults.logline}
        error={fieldError("logline")}
      />
    </>
  );
}
