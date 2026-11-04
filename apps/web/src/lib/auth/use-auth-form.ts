import { type FormEvent, type RefObject, useEffect, useRef, useState } from "react";
import { ApiError, NetworkError } from "../api/problem.ts";
import {
  type AuthFieldName,
  type AuthForm,
  describeAuthError,
  type FormFeedback,
  type SummaryEntry,
  summaryItems,
  validateRequired,
} from "./form-feedback.ts";

export interface AuthFormValues {
  readonly email: string;
  readonly password: string;
}

export interface UseAuthFormOptions<T extends AuthFormValues> {
  readonly form: AuthForm;
  /** The ids of the fields in the page, so the problem list can link to them. */
  readonly fieldIds: Readonly<Record<AuthFieldName, string>>;
  /** Reads the values from the form. Should trim the email and leave the password untouched. */
  readonly read: (data: FormData) => T;
  /** Sends the values to the API. Its errors are turned into words for the person. */
  readonly send: (values: T) => Promise<void>;
}

export interface UseAuthForm {
  /** True while a request is running. */
  readonly busy: boolean;
  /** The problems to list at the top of the form; empty when there are none. */
  readonly summary: readonly SummaryEntry[];
  /** Attach to the error summary: the focus moves there when there are new problems. */
  readonly summaryRef: RefObject<HTMLDivElement | null>;
  /** The message to show under one field, if any. */
  readonly fieldError: (field: AuthFieldName) => string | undefined;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

/** Reads a text field of a form, or "" if it is missing (or is a file, which these forms have none of). */
export function readText(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * The behavior that the login and sign-up forms share: check that the fields are filled in, send
 * the values once (a second press while the first request runs does nothing), turn a failure into
 * words, and move the focus to the list of problems so a screen reader reads them out.
 *
 * The values are read from the form when it is sent and kept nowhere else, so a password is never
 * copied into React state, and the fields keep what was typed after a failure.
 */
export function useAuthForm<T extends AuthFormValues>(options: UseAuthFormOptions<T>): UseAuthForm {
  const { form, fieldIds, read, send } = options;
  const [feedback, setFeedback] = useState<FormFeedback | undefined>(undefined);
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

    const values = read(new FormData(event.currentTarget));
    const missing = validateRequired(values, form);
    if (missing !== undefined) {
      setFeedback(missing);
      return;
    }

    running.current = true;
    setBusy(true);
    setFeedback(undefined);
    try {
      await send(values);
    } catch (error) {
      // Anything but a refused request or a missing connection is a bug or a changed API: the
      // person sees a general message, and the cause goes to the console.
      if (!(error instanceof ApiError) && !(error instanceof NetworkError)) console.error(error);
      setFeedback(describeAuthError(error, form));
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
