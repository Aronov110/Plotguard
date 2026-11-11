import { type RefObject, useRef, useState } from "react";
import { type Project, projectsApi } from "../api/projects-api.ts";
import type { ProjectFieldName } from "./project-form-feedback.ts";
import { type UseProjectForm, useProjectForm } from "./use-project-form.ts";

export interface UseCreateProjectFormOptions {
  /** The ids of the fields in the page, so the problem list can link to them. */
  readonly fieldIds: Readonly<Record<ProjectFieldName, string>>;
  /** Called with the new project once the API has created it. */
  readonly onCreated: (project: Project) => void;
}

export interface UseCreateProjectForm extends UseProjectForm {
  /** Attach to the title field: the focus returns there after a project was created. */
  readonly titleRef: RefObject<HTMLInputElement | null>;
  /** What to tell the person after a success, until the next attempt. */
  readonly created: string | undefined;
}

/**
 * The behavior of the "new project" form: the shared form behavior, and after a success the
 * fields are emptied, the focus goes back to the title (so the next project can be typed at once)
 * and a message says what was created.
 */
export function useCreateProjectForm(options: UseCreateProjectFormOptions): UseCreateProjectForm {
  const { fieldIds, onCreated } = options;
  const [created, setCreated] = useState<string | undefined>(undefined);
  const titleRef = useRef<HTMLInputElement | null>(null);

  const form = useProjectForm<Project>({
    fieldIds,
    send: ({ title, format, logline }) =>
      projectsApi.create({
        title,
        format,
        // A blank logline means "none"; the API says the same, so it is simply not sent.
        ...(logline.trim() === "" ? {} : { logline }),
      }),
    onAttempt: () => {
      setCreated(undefined);
    },
    onSuccess: (project, formElement) => {
      formElement.reset();
      onCreated(project);
      setCreated(`Project “${project.title}” created.`);
      titleRef.current?.focus();
    },
  });

  return { ...form, titleRef, created };
}
