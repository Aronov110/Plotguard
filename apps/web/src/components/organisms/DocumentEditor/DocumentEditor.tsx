import { type ReactElement, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type { DocumentDetail } from "../../../lib/api/documents-api.ts";
import { ApiError, NetworkError } from "../../../lib/api/problem.ts";
import { DOCUMENT_MAX_CHARACTERS } from "../../../lib/documents/count-text.ts";
import { describeLoadError } from "../../../lib/documents/document-feedback.ts";
import type { DocumentSaver } from "../../../lib/documents/document-saver.ts";
import { useDocumentEditor } from "../../../lib/documents/use-document-editor.ts";
import { Button } from "../../atoms/Button/Button.tsx";
import { ConflictNotice } from "../../molecules/ConflictNotice/ConflictNotice.tsx";
import { ErrorSummary } from "../../molecules/ErrorSummary/ErrorSummary.tsx";
import { SaveStatus } from "../../molecules/SaveStatus/SaveStatus.tsx";
import "./DocumentEditor.css";

export interface DocumentEditorProps {
  readonly projectId: string;
  /** The outline item that is open. The title is the outline's, which is always up to date. */
  readonly item: { readonly id: string; readonly title: string };
  /** Move the focus into the text when it has loaded. True when the writer chose this item. */
  readonly focusOnReady: boolean;
  /** Called with the server's word count after the text is saved, so the outline can show it. */
  readonly onWordCount: (id: string, wordCount: number) => void;
}

const words = (count: number): string =>
  `${count.toLocaleString("en")} ${count === 1 ? "word" : "words"}`;

/**
 * The text of one document. A plain multi-line box: it keeps the text exactly as typed, and it is
 * the box itself that holds the text, not React (so a very long text does not re-render with every
 * keystroke). Whatever is typed is saved by itself a moment after the writer pauses; the status line
 * always says whether it is saved.
 */
export function DocumentEditor({
  projectId,
  item,
  focusOnReady,
  onWordCount,
}: DocumentEditorProps): ReactElement {
  const editor = useDocumentEditor(projectId, item.id);
  const { load } = editor;

  if (load.status === "loading") {
    return <p role="status">Loading the text…</p>;
  }

  if (load.status === "failed") {
    return (
      <div className="document-editor__problem">
        <ErrorSummary items={[{ message: load.message }]} />
        <Button onClick={editor.retry}>Try again</Button>
      </div>
    );
  }

  return (
    <Writer
      title={item.title}
      document={load.document}
      saver={load.saver}
      readAgain={editor.readAgain}
      focusOnReady={focusOnReady}
      onWordCount={onWordCount}
    />
  );
}

interface WriterProps {
  readonly title: string;
  readonly document: DocumentDetail;
  readonly saver: DocumentSaver;
  readonly readAgain: () => Promise<DocumentDetail>;
  readonly focusOnReady: boolean;
  readonly onWordCount: (id: string, wordCount: number) => void;
}

function Writer({
  title,
  document,
  saver,
  readAgain,
  focusOnReady,
  onWordCount,
}: WriterProps): ReactElement {
  const snapshot = useSyncExternalStore(saver.subscribe, saver.getSnapshot, saver.getSnapshot);
  const ids = useId();
  const headingId = `${ids}-heading`;
  const textId = `${ids}-text`;
  const statusId = `${ids}-status`;
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  // True between the start and the end of typing through an input method (Chinese, Japanese,
  // Korean and others build a character in several steps). Half a character is not saved.
  const composing = useRef(false);
  const [conflictBusy, setConflictBusy] = useState(false);
  const [conflictError, setConflictError] = useState<string | undefined>(undefined);
  const [announcement, setAnnouncement] = useState({ text: "", serial: 0 });

  useEffect(() => {
    if (focusOnReady) textRef.current?.focus();
  }, [focusOnReady]);

  // The outline shows the server's word count, so it is told when a save changes it.
  const { wordCount } = snapshot;
  useEffect(() => {
    if (wordCount !== document.wordCount) onWordCount(document.id, wordCount);
  }, [wordCount, document.id, document.wordCount, onWordCount]);

  // Closing the tab or reloading with text the server does not have asks first. (A browser shows its
  // own words; the page cannot change them.) Also save when the page is hidden or put in the
  // background: the writer may be leaving.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent): void => {
      if (!saver.hasUnsaved()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const saveWhenHidden = (): void => {
      if (globalThis.document.visibilityState === "hidden") void saver.flush();
    };
    window.addEventListener("beforeunload", warn);
    window.addEventListener("pagehide", saveWhenHidden);
    globalThis.document.addEventListener("visibilitychange", saveWhenHidden);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("pagehide", saveWhenHidden);
      globalThis.document.removeEventListener("visibilitychange", saveWhenHidden);
    };
  }, [saver]);

  const announce = (text: string): void => {
    setAnnouncement((previous) => ({ text, serial: previous.serial + 1 }));
  };

  const keepMine = async (): Promise<void> => {
    setConflictBusy(true);
    setConflictError(undefined);
    try {
      await saver.overwrite();
    } finally {
      setConflictBusy(false);
    }
    textRef.current?.focus();
  };

  const loadNewer = async (): Promise<void> => {
    setConflictBusy(true);
    setConflictError(undefined);
    try {
      const newer = await readAgain();
      if (textRef.current !== null) textRef.current.value = newer.content;
      saver.reset(newer.content, newer.version, newer.wordCount);
      textRef.current?.focus();
    } catch (error) {
      if (!(error instanceof ApiError) && !(error instanceof NetworkError)) console.error(error);
      setConflictError(describeLoadError(error, "text"));
    } finally {
      setConflictBusy(false);
    }
  };

  const characters = snapshot.characters;
  return (
    <section className="document-editor" aria-labelledby={headingId}>
      <h2 id={headingId} className="document-editor__title">
        {title}
      </h2>
      {snapshot.status.kind === "conflict" ? (
        <ConflictNotice
          busy={conflictBusy}
          error={conflictError}
          onKeepMine={() => {
            void keepMine();
          }}
          onLoadNewer={() => {
            void loadNewer();
          }}
        />
      ) : null}
      <label htmlFor={textId} className="visually-hidden">
        Text of “{title}”
      </label>
      <textarea
        id={textId}
        ref={textRef}
        className="document-editor__text"
        defaultValue={document.content}
        aria-describedby={statusId}
        spellCheck
        autoComplete="off"
        onInput={(event) => {
          if (!composing.current) saver.change(event.currentTarget.value);
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          saver.change(event.currentTarget.value);
        }}
        onBlur={() => {
          void saver.flush();
        }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
            // The browser's own "save this page" is of no use here.
            event.preventDefault();
            void saver.flush().then(() => {
              if (saver.getSnapshot().status.kind === "saved") announce("Saved.");
            });
          }
        }}
      />
      <div id={statusId} className="document-editor__footer">
        <SaveStatus status={snapshot.status} />
        <p className="document-editor__counts">
          {words(snapshot.wordCount)}
          {characters === undefined
            ? null
            : ` · ${characters.toLocaleString("en")} of ${DOCUMENT_MAX_CHARACTERS.toLocaleString("en")} characters`}
        </p>
      </div>
      {/* Always in the page, so that a screen reader is already listening when its text changes. */}
      <p role="status" className="visually-hidden">
        {announcement.text === ""
          ? ""
          : announcement.text + (announcement.serial % 2 === 0 ? "\u00a0" : "")}
      </p>
    </section>
  );
}
