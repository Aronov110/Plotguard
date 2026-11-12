import type { ReactElement } from "react";
import "./AiPrivacyNotice.css";

export interface AiPrivacyNoticeProps {
  /** So that the Run button can name this notice as its description. */
  readonly id: string;
}

/**
 * Says where the text goes when a scan is run. It sits with the Run button every time, so nobody
 * sends their writing to a third party without having been told.
 */
export function AiPrivacyNotice({ id }: AiPrivacyNoticeProps): ReactElement {
  return (
    <p id={id} className="ai-privacy-notice">
      <strong>Before you run it:</strong> the text you chose is sent to Anthropic's Claude AI to be
      read. Plotpal does not keep a second copy of that text. It saves only the findings, in your
      history, until you delete them. Anthropic handles the text under its own terms.
    </p>
  );
}
