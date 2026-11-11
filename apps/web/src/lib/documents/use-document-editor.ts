import { useCallback, useEffect, useState } from "react";
import { type DocumentDetail, documentsApi } from "../api/documents-api.ts";
import { ApiError, NetworkError } from "../api/problem.ts";
import { useAuth } from "../auth/session.tsx";
import { describeLoadError } from "./document-feedback.ts";
import { createDocumentSaver, type DocumentSaver } from "./document-saver.ts";

export type DocumentEditorLoad =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  | {
      readonly status: "ready";
      /** The document as it was when it was read. Its text fills the editor once. */
      readonly document: DocumentDetail;
      readonly saver: DocumentSaver;
    };

export interface UseDocumentEditor {
  readonly load: DocumentEditorLoad;
  /** Loads the document again after it failed. */
  readonly retry: () => void;
  /** Reads the document as the server has it now, for "load the newer text". */
  readonly readAgain: () => Promise<DocumentDetail>;
}

// Saves that started when a writer left a document and have not finished. Opening the same document
// again waits for its save first; otherwise the new read could return the older text, and the next
// save would then conflict with the writer's own earlier one.
const leaving = new Map<string, Promise<void>>();

/**
 * Loads one document and sets up its autosave. When the document is left (another one is opened, the
 * screen is closed) what is pending is saved first, and that save is not cancelled.
 */
export function useDocumentEditor(projectId: string, documentId: string): UseDocumentEditor {
  const { withAuth } = useAuth();
  const [load, setLoad] = useState<DocumentEditorLoad>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` only counts the presses of "Try again"; changing it is what runs the load again
  useEffect(() => {
    const controller = new AbortController();
    const key = `${projectId}/${documentId}`;
    let saver: DocumentSaver | undefined;
    setLoad({ status: "loading" });

    const start = async (): Promise<void> => {
      await leaving.get(key);
      if (controller.signal.aborted) return;
      const document = await withAuth(() =>
        documentsApi.get(projectId, documentId, { signal: controller.signal }),
      );
      if (controller.signal.aborted) return;
      saver = createDocumentSaver(
        { text: document.content, version: document.version, wordCount: document.wordCount },
        {
          // No cancel signal: a save that has started must finish, even if the writer moves on.
          save: async (text, version) => {
            const saved = await withAuth(() =>
              documentsApi.update(projectId, documentId, { content: text }, { ifMatch: version }),
            );
            return { version: saved.version, wordCount: saved.wordCount };
          },
          load: async () => {
            const current = await withAuth(() => documentsApi.get(projectId, documentId));
            return { version: current.version };
          },
          setTimer: (callback, ms) => {
            const id = setTimeout(callback, ms);
            return () => {
              clearTimeout(id);
            };
          },
          reportError: (error) => {
            console.error(error);
          },
        },
      );
      setLoad({ status: "ready", document, saver });
    };

    start().catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (!(error instanceof ApiError) && !(error instanceof NetworkError)) console.error(error);
      setLoad({ status: "failed", message: describeLoadError(error, "text") });
    });

    return () => {
      controller.abort();
      if (saver === undefined) return;
      const finished = saver.leave().finally(() => {
        if (leaving.get(key) === finished) leaving.delete(key);
      });
      leaving.set(key, finished);
    };
  }, [projectId, documentId, attempt, withAuth]);

  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  const readAgain = useCallback(
    () => withAuth(() => documentsApi.get(projectId, documentId)),
    [projectId, documentId, withAuth],
  );

  return { load, retry, readAgain };
}
