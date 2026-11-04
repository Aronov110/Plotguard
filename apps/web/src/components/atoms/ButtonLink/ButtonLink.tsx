import type { ReactElement } from "react";
import { Link, type LinkProps } from "react-router";
import "../Button/Button.css";

export interface ButtonLinkProps extends Pick<LinkProps, "to" | "state" | "children"> {
  readonly variant?: "primary" | "secondary";
}

/**
 * A link that looks like a button. It is a link because it goes to another address (and so can be
 * opened in a new tab, bookmarked, and is announced as a link); a `Button` is for doing something.
 */
export function ButtonLink({ variant = "primary", ...rest }: ButtonLinkProps): ReactElement {
  return <Link {...rest} className={`button button--${variant}`} />;
}
