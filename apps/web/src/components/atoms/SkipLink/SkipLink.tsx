import type { ReactElement, ReactNode } from "react";
import "./SkipLink.css";

export interface SkipLinkProps {
  /** The `id` of the element to jump to. It needs `tabIndex={-1}` to accept the focus. */
  readonly targetId: string;
  readonly children: ReactNode;
}

/**
 * A link that is invisible until the keyboard reaches it, and jumps over the header to the content.
 * Without it, a keyboard user has to tab through the whole header on every screen (WCAG 2.4.1).
 */
export function SkipLink({ targetId, children }: SkipLinkProps): ReactElement {
  return (
    <a
      className="skip-link"
      href={`#${targetId}`}
      onClick={(event) => {
        // Move the focus ourselves instead of following the "#id" link: that would add an entry to
        // the browser history and put a fragment in the address.
        event.preventDefault();
        document.getElementById(targetId)?.focus();
      }}
    >
      {children}
    </a>
  );
}
