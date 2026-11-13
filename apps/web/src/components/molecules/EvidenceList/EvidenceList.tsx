import type { ReactElement } from "react";
import { Link } from "react-router";
import type { Evidence } from "../../../lib/api/analyses-api.ts";
import "./EvidenceList.css";

export interface EvidenceListProps {
  readonly evidence: readonly Evidence[];
  /** The title of each item that is still in the outline, by id. Only these get a link. */
  readonly titles: ReadonlyMap<string, string>;
  /** Names the list for a screen reader: "Passages that show it". */
  readonly label: string;
  /**
   * Called with the id of the item when its link is pressed, so that the writing screen can move
   * the focus into that item's text. The link itself already opens the item.
   */
  readonly onOpenItem: (id: string) => void;
}

/**
 * The passages an AI points to, each marked as found in the writer's text or not (an AI can invent
 * a quote), with a link to the item it is in when that item is still in the outline. The text is
 * the AI's, so it is shown as plain text only, and "found" is said in words, never only in colour.
 * Shared by a plot-hole finding and an idea.
 */
export function EvidenceList({
  evidence,
  titles,
  label,
  onOpenItem,
}: EvidenceListProps): ReactElement {
  return (
    <ul className="evidence-list" aria-label={label}>
      {evidence.map((entry, index) => {
        const itemId = entry.documentId;
        const title = itemId === null ? undefined : titles.get(itemId);
        return (
          // The AI may quote the same passage twice, so the position is part of the key.
          // biome-ignore lint/suspicious/noArrayIndexKey: the list never changes after it is shown
          <li key={`${index}-${entry.documentId ?? "none"}`} className="evidence-list__passage">
            <blockquote className="evidence-list__quote">{entry.quote}</blockquote>
            <p
              className={
                entry.verified
                  ? "evidence-list__check evidence-list__check--found"
                  : "evidence-list__check evidence-list__check--missing"
              }
            >
              {entry.verified
                ? "Found in your text."
                : "Not found in your text. The AI may have invented or changed it."}
            </p>
            {itemId !== null && title !== undefined ? (
              <p className="evidence-list__where">
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
  );
}
