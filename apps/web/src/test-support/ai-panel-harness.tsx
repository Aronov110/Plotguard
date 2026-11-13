import { type ReactElement, useState } from "react";
import { AiPanel, type AiPanelProps } from "../components/organisms/AiPanel/AiPanel.tsx";

/**
 * What the writing screen does around the AI panel, reduced to the minimum for a test: a button called
 * "AI assistant" that shows and hides the panel, and the panel itself, which stays in the page while
 * it is hidden (as in the drawer). The panel's own tests open it by pressing the button.
 */
export function AiPanelHarness(props: Omit<AiPanelProps, "open">): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((previous) => !previous);
        }}
      >
        AI assistant
      </button>
      <div hidden={!open}>
        <AiPanel {...props} open={open} />
      </div>
    </>
  );
}
