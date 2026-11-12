import {
  type SubmitEvent as ReactSubmitEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { type DocumentDetail, documentsApi } from "../api/documents-api.ts";
import { ApiError, NetworkError } from "../api/problem.ts";
import { useAuth } from "../auth/session.tsx";
import { readText } from "../auth/use-auth-form.ts";
import { type AddItemProblem, describeAddItemError } from "./document-feedback.ts";

export interface UseAddItemOptions {
  readonly projectId: string;
  /**
   * The act or chapter that "inside" means, if there is one. The form offers "inside" only then; a
   * scene is added under it.
   */
  readonly insideId: string | undefined;
  /** Called with the new document once the API has created it. */
  readonly onAdded: (document: DocumentDetail) => void;
}

export interface UseAddItem {
  readonly busy: boolean;
  /** The problems to list at the top of the form; empty when there are none. */
  readonly summary: readonly { readonly message: string; readonly fieldId?: string }[];
  /** Attach to the error summary: the focus moves there when there are new problems. */
  readonly summaryRef: RefObject<HTMLDivElement | null>;
  /** The message to show under the title, if any. */
  readonly titleError: string | undefined;
  readonly onSubmit: (event: ReactSubmitEvent<HTMLFormElement>) => void;
}

/**
 * The behavior of the "add to the outline" form: check that the title is filled in, send it once (a
 * second press while the first request runs does nothing), turn a failure into words, and move the
 * focus to the list of problems after a failure.
 *
 * @param titleFieldId The `id` of the title field, so the problem list can link to it.
 */
export function useAddItem(titleFieldId: string, options: UseAddItemOptions): UseAddItem {
  const { projectId, insideId, onAdded } = options;
  const { withAuth } = useAuth();
  const [problem, setProblem] = useState<AddItemProblem | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  // A ref as well as state: two clicks in a row can arrive before React has re-rendered the button.
  const running = useRef(false);
  const summaryRef = useRef<HTMLDivElement | null>(null);

  // Each failed attempt sets a new problem object, so the focus moves again for the same words.
  useEffect(() => {
    if (problem !== undefined) summaryRef.current?.focus();
  }, [problem]);

  const submit = async (event: ReactSubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (running.current) return;

    // Kept before the first `await`: React clears `currentTarget` once the handler returns.
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    const title = readText(data, "title");
    const inside = readText(data, "where") === "inside" && insideId !== undefined;

    if (title.trim() === "") {
      setProblem({ title: "Enter a title.", general: [] });
      return;
    }

    running.current = true;
    setBusy(true);
    setProblem(undefined);
    try {
      const document = await withAuth(() =>
        documentsApi.create(projectId, { title, ...(inside ? { parentId: insideId } : {}) }),
      );
      formElement.reset();
      onAdded(document);
    } catch (error) {
      // Anything but a refused request or a missing connection is a bug or a changed API: the
      // person sees a general message, and the cause goes to the console.
      if (!(error instanceof ApiError) && !(error instanceof NetworkError)) console.error(error);
      setProblem(describeAddItemError(error));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const summary =
    problem === undefined
      ? []
      : [
          ...(problem.title === undefined
            ? []
            : [{ message: problem.title, fieldId: titleFieldId }]),
          ...problem.general.map((message) => ({ message })),
        ];

  return {
    busy,
    summary,
    summaryRef,
    titleError: problem?.title,
    onSubmit: (event) => {
      void submit(event);
    },
  };
}
