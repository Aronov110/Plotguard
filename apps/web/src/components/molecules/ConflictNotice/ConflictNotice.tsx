import type { ReactElement } from "react";
import { Button } from "../../atoms/Button/Button.tsx";
import { InlineError } from "../../atoms/InlineError/InlineError.tsx";
import "./ConflictNotice.css";

export interface ConflictNoticeProps {
  /** One of the two actions is running. */
  readonly busy: boolean;
  /** Why the last action failed, in words. */
  readonly error: string | undefined;
  /** Save the text on the screen over the newer version. */
  readonly onKeepMine: () => void;
  /** Replace the text on the screen with the newer version. */
  readonly onLoadNewer: () => void;
}

/**
 * Shown when another tab or device saved a newer version of the same text first. Nothing is lost
 * yet: the writer's text is still in the box and the newer one is still on the server, so it asks
 * which of the two to keep, with words that say exactly what each button does.
 */
export function ConflictNotice({
  busy,
  error,
  onKeepMine,
  onLoadNewer,
}: ConflictNoticeProps): ReactElement {
  return (
    <div role="alert" className="conflict-notice">
      <p className="conflict-notice__text">
        <strong>This text was changed somewhere else.</strong> Another tab or device saved a newer
        version after you opened it. Your text is still in the box and nothing has been overwritten.
        To keep both, copy your text first. Then choose:
      </p>
      {error === undefined ? null : <InlineError id="conflict-notice-error">{error}</InlineError>}
      <div className="conflict-notice__buttons">
        <Button variant="secondary" busy={busy} onClick={onKeepMine}>
          Save my text over theirs
        </Button>
        <Button variant="secondary" busy={busy} onClick={onLoadNewer}>
          Load the newer text (discard mine)
        </Button>
      </div>
    </div>
  );
}
