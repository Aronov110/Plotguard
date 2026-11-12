import type { ReactElement } from "react";
import { Link } from "react-router";
import {
  categoryLabel,
  severityLabel,
  severityWord,
} from "../../../lib/analyses/analysis-feedback.ts";
import type { Finding } from "../../../lib/api/analyses-api.ts";
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

      <ul className="finding-card__evidence" aria-label="Passages that show it">
        {finding.evidence.map((evidence, index) => {
          const itemId = evidence.documentId;
          const title = itemId === null ? undefined : titles.get(itemId);
          return (
            // The AI may quote the same passage twice, so the position is part of the key.
            // biome-ignore lint/suspicious/noArrayIndexKey: the list never changes after it is shown
            <li key={`${index}-${evidence.documentId ?? "none"}`} className="finding-card__passage">
              <blockquote className="finding-card__quote">{evidence.quote}</blockquote>
              <p
                className={
                  evidence.verified
                    ? "finding-card__check finding-card__check--found"
                    : "finding-card__check finding-card__check--missing"
                }
              >
                {evidence.verified
                  ? "Found in your text."
                  : "Not found in your text. The AI may have invented or changed it."}
              </p>
              {itemId !== null && title !== undefined ? (
                <p className="finding-card__where">
                  In{" "}
                  <Link
                    to={{ search: `?document=${encodeURIComponent(itemId)}` }}
                    onClick={() => {
                      onOpenItem(itemId);
                    }}
                  >
                    {title}
                  </Link>
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {finding.suggestion === "" ? null : (
        <p className="finding-card__suggestion">
          <strong>A way to fix it:</strong> {finding.suggestion}
        </p>
      )}
    </li>
  );
}
