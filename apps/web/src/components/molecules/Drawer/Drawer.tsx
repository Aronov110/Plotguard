import {
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
} from "react";
import { Button } from "../../atoms/Button/Button.tsx";
import { Icon } from "../../atoms/Icon/Icon.tsx";
import "./Drawer.css";

export interface DrawerProps {
  /** For the toggle button's `aria-controls`. */
  readonly id: string;
  readonly open: boolean;
  /** The name of the panel: its heading, and what the landmark is called. */
  readonly title: string;
  /** Called by the Close button and by Escape pressed inside the panel. */
  readonly onClose: () => void;
  /**
   * Where the focus goes after the panel is closed from inside (the toggle that opened it). Closing
   * with the toggle itself leaves the focus where it is.
   */
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  readonly children: ReactNode;
}

/**
 * A side panel that slides in next to the page. It is a labelled landmark, not a dialog: the page
 * behind it stays usable and nothing traps the focus. Opening moves the focus to its heading, so a
 * keyboard or screen reader user arrives in it; Close or Escape shuts it and puts the focus back on
 * the toggle. Closed, it is `inert` (out of the tab order and hidden from assistive technology) but
 * its contents stay in the page, so what runs inside it goes on running.
 *
 * How it looks and moves (a column that grows, or a block under the text) is the page's concern: the
 * page sets the size of the box this fills and reads `data-open`.
 */
export function Drawer({
  id,
  open,
  title,
  onClose,
  returnFocusRef,
  children,
}: DrawerProps): ReactElement {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const wasOpen = useRef(open);

  // The focus goes to the heading when the panel opens, but not when the page starts with it open.
  useEffect(() => {
    if (open && !wasOpen.current) headingRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const close = (): void => {
    onClose();
    returnFocusRef?.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    // Something inside (a delete question, say) may use Escape for itself and stop it first.
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      close();
    }
  };

  return (
    <aside
      id={id}
      className="drawer"
      aria-labelledby={headingId}
      data-open={open ? "true" : "false"}
      inert={!open}
      onKeyDown={handleKeyDown}
    >
      <div className="drawer__inner">
        <div className="drawer__top">
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className="drawer__title">
            {title}
          </h2>
          <Button variant="secondary" onClick={close}>
            <Icon name="x" />
            <span className="visually-hidden">Close the panel</span>
          </Button>
        </div>
        <div className="drawer__body">{children}</div>
      </div>
    </aside>
  );
}
