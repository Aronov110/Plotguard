import type { ReactElement } from "react";
import type { AnalysisKind } from "../../../lib/api/analyses-api.ts";
import "./AiPrivacyNotice.css";

export interface AiPrivacyNoticeProps {
  /** So that the Run button can name this notice as its description. */
  readonly id: string;
  /** What will be run. Ideas also send, and save, the focus the writer typed. Plot holes when left out. */
  readonly kind?: AnalysisKind;
}

/**
 * Says where the text goes when the AI is run. It sits with the Run button every time, so nobody
 * sends their writing to a third party without having been told. For ideas it also says that the
 * focus goes along and is saved, because the focus is the writer's own words and is kept with the run.
 */
export function AiPrivacyNotice({ id, kind = "plot_holes" }: AiPrivacyNoticeProps): ReactElement {
  return (
    <p id={id} className="ai-privacy-notice">
      <strong>Before you run it:</strong>{" "}
      {kind === "ideas" ? (
        <>
          the text you chose, and the focus if you write one, is sent to Anthropic's Claude AI to be
          read. Plotpal does not keep a second copy of that text. It saves only the ideas and your
          focus, in your history, until you delete them. Anthropic handles the text under its own
          terms.
        </>
      ) : (
        <>
          the text you chose is sent to Anthropic's Claude AI to be read. Plotpal does not keep a
          second copy of that text. It saves only the findings, in your history, until you delete
          them. Anthropic handles the text under its own terms.
        </>
      )}
    </p>
  );
}
