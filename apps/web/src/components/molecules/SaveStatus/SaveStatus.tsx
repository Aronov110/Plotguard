import type { ReactElement } from "react";
import type { SaveStatus as SaveState } from "../../../lib/documents/document-saver.ts";
import "./SaveStatus.css";

/**
 * Says in words whether the text on the screen is saved. The calm states ("Saved", "Unsaved
 * changes", "Saving…") change every few seconds while someone writes, so they are not announced by a
 * screen reader; a problem is, because the writer needs to know. The words, not the colour, carry
 * the meaning.
 */
export function SaveStatus({ status }: { readonly status: SaveState }): ReactElement {
  switch (status.kind) {
    case "saved":
      return <p className="save-status">Saved</p>;
    case "unsaved":
      return <p className="save-status">Unsaved changes</p>;
    case "saving":
      return <p className="save-status">Saving…</p>;
    case "conflict":
      // The conflict notice above the text explains it.
      return <p className="save-status save-status--problem">Not saved</p>;
    case "retrying":
    case "invalid":
      return (
        <div role="alert" className="save-status save-status--problem">
          <p>Not saved. {status.message}</p>
        </div>
      );
    case "gone":
      return (
        <div role="alert" className="save-status save-status--problem">
          <p>
            Not saved. This document does not exist any more. Your text is still here: copy it
            before you leave.
          </p>
        </div>
      );
  }
}
