import type { ReactElement } from "react";
import {
  categoryLabel,
  severityLabel,
  severityWord,
} from "../../../lib/analyses/analysis-feedback.ts";
import type { Finding } from "../../../lib/api/analyses-api.ts";
import { EvidenceList } from "../EvidenceList/EvidenceList.tsx";
import "./FindingCard.css";

export interface FindingCardProps {
  readonly finding: Finding;
  /** The title of each item that is still in the outline, by id. Only these get a link. */
  readonly titles: ReadonlyMap<string, string>;
  /**
   * Called with the id of the item when its link is pressed, so that the writing screen can move
   * the focus into that item's text. The link itself already opens the item.
   */
  readonly onOpenItem: (id: string) => void;
}

/**
 * One plot hole the AI found: what it is, how serious, why, the passages that show it (each marked
 * as found in the writer's text or not, because an AI can invent a quote) and a way to fix it. The
 * text is the AI's, so it is shown as plain text only. Severity and the quote check are in words,
 * never only in colour. A passage in an item that is still in the outline links to that item.
 */
export function FindingCard({ finding, titles, onOpenItem }: FindingCardProps): ReactElement {
  return (
    <li className={`finding-card finding-card--${finding.severity}`}>
      <h4 className="finding-card__title">{finding.title}</h4>
      <p className="finding-card__tags">
        <span className="finding-card__severity" title={severityLabel(finding.severity)}>
          {severityWord(finding.severity)}
        </span>
        <span className="finding-card__category">{categoryLabel(finding.category)}</span>
      </p>
      <p className="finding-card__explanation">{finding.explanation}</p>

      <EvidenceList
        evidence={finding.evidence}
        titles={titles}
        label="Passages that show it"
        onOpenItem={onOpenItem}
      />

      {finding.suggestion === "" ? null : (
        <p className="finding-card__suggestion">
          <strong>A way to fix it:</strong> {finding.suggestion}
        </p>
      )}
    </li>
  );
}
