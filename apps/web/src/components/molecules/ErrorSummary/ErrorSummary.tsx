import { type MouseEvent, type ReactElement, type Ref, useId } from "react";
import { Icon } from "../../atoms/Icon/Icon.tsx";
import "./ErrorSummary.css";

export interface ErrorSummaryItem {
  readonly message: string;
  /** The `id` of the field the problem belongs to. Without it the message is plain text. */
  readonly fieldId?: string;
}

export interface ErrorSummaryProps {
  readonly items: readonly ErrorSummaryItem[];
  /** Lets a form move the focus here after a failed attempt, so the problems are read out. */
  readonly ref?: Ref<HTMLDivElement>;
}

function focusField(event: MouseEvent<HTMLAnchorElement>, fieldId: string): void {
  // Move the focus ourselves instead of following the "#id" link: that would add an entry to the
  // browser history and put a fragment in the address.
  event.preventDefault();
  document.getElementById(fieldId)?.focus();
}

/**
 * A box at the top of a form that lists everything that is wrong, each problem linking to its
 * field. It is announced when it appears and can be focused by code. It shows nothing when the
 * list is empty. Messages are shown as plain text, whatever they contain.
 */
export function ErrorSummary({ items, ref }: ErrorSummaryProps): ReactElement | null {
  const headingId = useId();
  if (items.length === 0) return null;

  return (
    <div ref={ref} className="error-summary" role="alert" tabIndex={-1} aria-labelledby={headingId}>
      <h2 id={headingId} className="error-summary__title">
        <Icon name="alert" />
        There is a problem
      </h2>
      <ul className="error-summary__list">
        {items.map((item) => (
          <li key={`${item.fieldId ?? "general"}:${item.message}`}>
            {item.fieldId === undefined ? (
              item.message
            ) : (
              <a
                href={`#${item.fieldId}`}
                onClick={(event) => {
                  if (item.fieldId !== undefined) focusField(event, item.fieldId);
                }}
              >
                {item.message}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
