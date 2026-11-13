import type { ReactElement } from "react";
import { Link } from "react-router";
import { ideaKindLabel } from "../../../lib/analyses/analysis-feedback.ts";
import type { Idea } from "../../../lib/api/analyses-api.ts";
import { EvidenceList } from "../EvidenceList/EvidenceList.tsx";
import "./IdeaCard.css";

export interface IdeaCardProps {
  readonly idea: Idea;
  /** The title of each item that is still in the outline, by id. Only these get a link. */
  readonly titles: ReadonlyMap<string, string>;
  /**
   * Called with the id of the item when a link to it is pressed, so that the writing screen can move
   * the focus into that item's text. The link itself already opens the item.
   */
  readonly onOpenItem: (id: string) => void;
}

/**
 * One idea the AI suggests: what it is, the kind it is, why it fits the story (with the passages it
 * builds on, each marked as found in the writer's text or not) and where it could go. It is a
 * suggestion, not a fix, and the text is the AI's, so it is shown as plain text only.
 */
export function IdeaCard({ idea, titles, onOpenItem }: IdeaCardProps): ReactElement {
  // Only an item that is still in the outline can be linked to; the model's id is never trusted.
  const goesInTitle = idea.goesIn === null ? undefined : titles.get(idea.goesIn);
  return (
    <li className="idea-card">
      <h4 className="idea-card__title">{idea.title}</h4>
      <p className="idea-card__tags">
        <span className="idea-card__kind">{ideaKindLabel(idea.kind)}</span>
      </p>
      <p className="idea-card__description">{idea.description}</p>
      <p className="idea-card__why">
        <strong>Why it fits:</strong> {idea.whyItFits}
      </p>

      {idea.evidence.length === 0 ? null : (
        <EvidenceList
          evidence={idea.evidence}
          titles={titles}
          label="Passages it builds on"
          onOpenItem={onOpenItem}
        />
      )}

      {idea.goesIn !== null && goesInTitle !== undefined ? (
        <p className="idea-card__goes-in">
          <strong>Could go in:</strong>{" "}
          <Link
            to={{ search: `?document=${encodeURIComponent(idea.goesIn)}` }}
            onClick={() => {
              if (idea.goesIn !== null) onOpenItem(idea.goesIn);
            }}
          >
            {goesInTitle}
          </Link>
        </p>
      ) : null}
    </li>
  );
}
