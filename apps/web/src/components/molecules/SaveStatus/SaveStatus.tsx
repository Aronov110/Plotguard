import type { ReactElement } from "react";
import type { SaveStatus as SaveState } from "../../../lib/documents/document-saver.ts";
import { Icon } from "../../atoms/Icon/Icon.tsx";
import "./SaveStatus.css";

/**
 * Says in words whether the text on the screen is saved, in a small pill with a picture that moves a
 * little (a check that draws itself, a spinner). The calm states ("Saved", "Unsaved changes",
 * "Saving…") change every few seconds while someone writes, so they are not announced by a screen
 * reader; a problem is, because the writer needs to know. The words, not the picture or the colour,
 * carry the meaning, and the movement stops for people who ask for less of it.
 */
export function SaveStatus({ status }: { readonly status: SaveState }): ReactElement {
  switch (status.kind) {
    case "saved":
      return (
        <p className="save-status save-status--saved">
          <Icon name="check" />
          <span>Saved</span>
        </p>
      );
    case "unsaved":
      return (
        <p className="save-status save-status--unsaved">
          <span className="save-status__dot" aria-hidden="true" />
          <span>Unsaved changes</span>
        </p>
      );
    case "saving":
      return (
        <p className="save-status save-status--saving">
          <span className="save-status__spinner" aria-hidden="true" />
          <span>Saving…</span>
        </p>
      );
    case "conflict":
      // The conflict notice above the text explains it.
      return (
        <p className="save-status save-status--problem">
          <Icon name="alert" />
          <span>Not saved</span>
        </p>
      );
    case "retrying":
    case "invalid":
      return (
        <div role="alert" className="save-status save-status--problem">
          <Icon name="alert" />
          <p>Not saved. {status.message}</p>
        </div>
      );
    case "gone":
      return (
        <div role="alert" className="save-status save-status--problem">
          <Icon name="alert" />
          <p>
            Not saved. This document does not exist any more. Your text is still here: copy it
            before you leave.
          </p>
        </div>
      );
  }
}
