import type { ReactElement, ReactNode } from "react";
import "./PageHeading.css";

/**
 * The one level-one heading of a screen. It can be focused by code (but is not in the tab order),
 * so that after a navigation the focus can move here and a screen reader starts reading the new
 * screen from its title.
 */
export function PageHeading({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <h1 className="page-heading" tabIndex={-1}>
      {children}
    </h1>
  );
}
