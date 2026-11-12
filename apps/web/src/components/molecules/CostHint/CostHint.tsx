import type { ReactElement } from "react";
import {
  describeAllowance,
  describeCost,
  describeSize,
} from "../../../lib/analyses/format-cost.ts";
import type { EstimateView } from "../../../lib/analyses/use-analysis-panel.ts";
import { Button } from "../../atoms/Button/Button.tsx";
import "./CostHint.css";

export interface CostHintProps {
  readonly view: EstimateView;
  readonly onRetry: () => void;
}

/**
 * What a scan would cost, before it is run: the size of the text, a rough price and what is left of
 * the day's allowance. It makes no AI call. A text that is too long for one scan says so here.
 */
export function CostHint({ view, onRetry }: CostHintProps): ReactElement | null {
  switch (view.status) {
    case "idle":
      return null;
    case "loading":
      return (
        <p role="status" className="cost-hint">
          Working out the cost…
        </p>
      );
    case "failed":
      return (
        <div className="cost-hint cost-hint--problem">
          <p>{view.message}</p>
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        </div>
      );
    case "ready": {
      const { estimate } = view;
      return (
        <div role="status" className="cost-hint">
          <p>
            {describeSize(estimate.characters)} {describeCost(estimate)}{" "}
            {describeAllowance(estimate.remaining)}
          </p>
          {estimate.fits ? null : (
            <p className="cost-hint__warning">
              This text is too long for one scan. Choose a single act or scene.
            </p>
          )}
        </div>
      );
    }
  }
}
