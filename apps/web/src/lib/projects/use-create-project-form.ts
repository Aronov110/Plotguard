import { type FormEvent, type RefObject, useEffect, useRef, useState } from "react";
import { ApiError, NetworkError } from "../api/problem.ts";
import { PROJECT_FORMATS, type Project, projectsApi } from "../api/projects-api.ts";
import { useAuth } from "../auth/session.tsx";
import { readText } from "../auth/use-auth-form.ts";
import {
  describeProjectError,
  type ProjectFieldName,
  type ProjectFormFeedback,
  type ProjectSummaryEntry,
  summaryItems,
  validateRequired,
} from "./project-form-feedback.ts";

export interface UseCreateProjectFormOptions {
  /** The ids of the fields in the page, so the problem list can link to them. */
  readonly fieldIds: Readonly<Record<ProjectFieldName, string>>;
  /** Called with the new project once the API has created it. */
  readonly onCreated: (project: Project) => void;
}

export interface UseCreateProjectForm {
  /** True while a request is running. */
  readonly busy: boolean;
  /** The problems to list at the top of the form; empty when there are none. */
  readonly summary: readonly ProjectSummaryEntry[];
  /** Attach to the error summary: the focus moves there when there are new problems. */
  readonly summaryRef: RefObject<HTMLDivElement | null>;
  /** Attach to the title field: the focus returns there after a project was created. */
  readonly titleRef: RefObject<HTMLInputElement | null>;
  /** The message to show under one field, if any. */
  readonly fieldError: (field: ProjectFieldName) => string | undefined;
  /** What to tell the person after a success, until the next attempt. */
  readonly created: string | undefined;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

/**
 * The behavior of the "new project" form: check that the title is filled in, send the values once
 * (a second press while the first request runs does nothing), turn a failure into words, and move
 * the focus: to the list of problems after a failure, back to the title after a success.
 *
 * The values are read from the form when it is sent, so the fields keep what was typed after a
 * failure (the person does not type it twice) and are emptied only after a success.
 */
export function useCreateProjectForm(options: UseCreateProjectFormOptions): UseCreateProjectForm {
  const { fieldIds, onCreated } = options;
  const { withAuth } = useAuth();
  const [feedback, setFeedback] = useState<ProjectFormFeedback | undefined>(undefined);
  const [created, setCreated] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  // A ref as well as state: two clicks in a row can arrive before React has re-rendered the button.
  const running = useRef(false);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);

  // Each failed attempt sets a new feedback object, so the focus moves again even if the words are
  // the same as last time.
  useEffect(() => {
    if (feedback !== undefined) summaryRef.current?.focus();
  }, [feedback]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (running.current) return;

    // Kept before the first `await`: React clears `currentTarget` once the handler returns.
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    const title = readText(data, "title");
    const logline = readText(data, "logline");
    const format = PROJECT_FORMATS.find((candidate) => candidate === readText(data, "format"));

    const missing = validateRequired({ title, format: format ?? "" });
    if (missing !== undefined || format === undefined) {
      setCreated(undefined);
      setFeedback(missing ?? { fieldErrors: { format: "Choose a format." }, general: [] });
      return;
    }

    running.current = true;
    setBusy(true);
    setFeedback(undefined);
    setCreated(undefined);
    try {
      const project = await withAuth(() =>
        projectsApi.create({
          title,
          format,
          // A blank logline means "none"; the API says the same, so it is simply not sent.
          ...(logline.trim() === "" ? {} : { logline }),
        }),
      );
      formElement.reset();
      onCreated(project);
      setCreated(`Project “${project.title}” created.`);
      titleRef.current?.focus();
    } catch (error) {
      // Anything but a refused request or a missing connection is a bug or a changed API: the
      // person sees a general message, and the cause goes to the console.
      if (!(error instanceof ApiError) && !(error instanceof NetworkError)) console.error(error);
      setFeedback(describeProjectError(error));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return {
    busy,
    summary: feedback === undefined ? [] : summaryItems(feedback, fieldIds),
    summaryRef,
    titleRef,
    fieldError: (field) => feedback?.fieldErrors[field],
    created,
    onSubmit: (event) => {
      void submit(event);
    },
  };
}
