import { type ReactElement, useId } from "react";
import { Link } from "react-router";
import type { OutlineNode } from "../../../lib/documents/use-outline.ts";
import "./OutlineNav.css";

/** The query string that opens a document: `?document=<id>`. */
export function documentSearch(id: string): string {
  return `?document=${encodeURIComponent(id)}`;
}

export interface OutlineNavProps {
  readonly nodes: readonly OutlineNode[];
  /** The id of the document that is open, if any. It is marked as the current page. */
  readonly selectedId: string | undefined;
  /** Called when the writer picks an item, so the screen can move the focus into its text. */
  readonly onSelect: (id: string) => void;
}

function words(count: number): string {
  return `${count.toLocaleString("en")} ${count === 1 ? "word" : "words"}`;
}

function OutlineList({
  nodes,
  selectedId,
  onSelect,
}: {
  readonly nodes: readonly OutlineNode[];
  readonly selectedId: string | undefined;
  readonly onSelect: (id: string) => void;
}): ReactElement {
  return (
    // biome-ignore lint/a11y/noRedundantRoles: Safari drops the list meaning of a list with list-style: none
    <ul className="outline-nav__list" role="list">
      {nodes.map((node) => (
        <li key={node.id} className="outline-nav__item">
          <Link
            to={{ search: documentSearch(node.id) }}
            className="outline-nav__link"
            aria-current={node.id === selectedId ? "page" : undefined}
            onClick={() => {
              onSelect(node.id);
            }}
          >
            {node.title}
          </Link>
          <span className="outline-nav__words">{words(node.wordCount)}</span>
          {node.children.length === 0 ? null : (
            <OutlineList nodes={node.children} selectedId={selectedId} onSelect={onSelect} />
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The outline of the project as a navigation: acts and chapters with their scenes inside, each one a
 * link that opens its text. Links (not buttons) because choosing an item changes the address, so the
 * Back button works and a writer can bookmark the scene they are on.
 */
export function OutlineNav({ nodes, selectedId, onSelect }: OutlineNavProps): ReactElement {
  const headingId = useId();

  return (
    <nav aria-labelledby={headingId} className="outline-nav">
      <h2 id={headingId} className="outline-nav__heading">
        Outline
      </h2>
      {nodes.length === 0 ? (
        <p>
          This project has no outline yet. Add an act or a chapter below, then add scenes inside it.
        </p>
      ) : (
        <OutlineList nodes={nodes} selectedId={selectedId} onSelect={onSelect} />
      )}
    </nav>
  );
}
