import { type FormEvent, type RefObject, useEffect, useRef, useState } from "react";
import { ApiError, NetworkError } from "../api/problem.ts";
import { PROJECT_FORMATS } from "../api/projects-api.ts";
import { useAuth } from "../auth/session.tsx";
import { readText } from "../auth/use-auth-form.ts";
import type { ProjectFormValues } from "./project-changes.ts";
import {
  describeProjectError,
  type ProjectFieldName,
  type ProjectFormFeedback,
  type ProjectSummaryEntry,
  summaryItems,
  validateRequired,
} from "./project-form-feedback.ts";

export interface UseProjectFormOptions<T> {
  /** The ids of the fields in the page, so the problem list can link to them. */
  readonly fieldIds: Readonly<Record<ProjectFieldName, string>>;
  /**
   * Sends the checked values to the API, and gives back what the caller needs afterwards. It runs
   * through `withAuth`, so an expired token is renewed once. Its failures are turned into words.
   */
  readonly send: (values: ProjectFormValues) => Promise<T>;
  /** Called after a success, with what `send` returned and the form element. */
  readonly onSuccess: (result: T, form: HTMLFormElement) => void;
  /** Called when an attempt starts, and when the check fails, so an old message can be cleared. */
  readonly onAttempt?: () => void;
}

export interface UseProjectForm {
  /** True while a request is running. */
  readonly busy: boolean;
  /** The problems to list at the top of the form; empty when there are none. */
  readonly summary: readonly ProjectSummaryEntry[];
  /** Attach to the error summary: the focus moves there when there are new problems. */
  readonly summaryRef: RefObject<HTMLDivElement | null>;
  /** The message to show under one field, if any. */
  readonly fieldError: (field: ProjectFieldName) => string | undefined;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

/**
 * The behavior that the "new project" and "edit project" forms share: check that the title is
 * filled in and a format is chosen, send the values once (a second press while the first request
 * runs does nothing), turn a failure into words, and move the focus to the list of problems after a
 * failure so a screen reader reads them out.
 *
 * The values are read from the form when it is sent, so the fields keep what was typed after a
 * failure (the person does not type it twice). What happens after a success is the caller's.
 */
export function useProjectForm<T>(options: UseProjectFormOptions<T>): UseProjectForm {
  const { fieldIds, send, onSuccess, onAttempt } = options;
  const { withAuth } = useAuth();
  const [feedback, setFeedback] = useState<ProjectFormFeedback | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  // A ref as well as state: two clicks in a row can arrive before React has re-rendered the button.
  const running = useRef(false);
  const summaryRef = useRef<HTMLDivElement | null>(null);

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
      onAttempt?.();
      setFeedback(missing ?? { fieldErrors: { format: "Choose a format." }, general: [] });
      return;
    }

    running.current = true;
    setBusy(true);
    setFeedback(undefined);
    onAttempt?.();
    try {
      const result = await withAuth(() => send({ title, format, logline }));
      onSuccess(result, formElement);
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
    fieldError: (field) => feedback?.fieldErrors[field],
    onSubmit: (event) => {
      void submit(event);
    },
  };
}
