import type { ReactElement, ReactNode } from "react";
import { PageHeading } from "../../atoms/PageHeading/PageHeading.tsx";
import "./AuthLayout.css";

export interface AuthLayoutProps {
  /** The title of the screen, shown as its level-one heading. */
  readonly title: string;
  /** Something under the card, for example a link to the other form. */
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}

/** The frame of the sign-up and login screens: a centered card under one heading. */
export function AuthLayout({ title, footer, children }: AuthLayoutProps): ReactElement {
  return (
    <main id="main-content" className="auth-layout">
      <div className="auth-layout__card">
        <PageHeading>{title}</PageHeading>
        {children}
      </div>
      {footer === undefined ? null : <p className="auth-layout__footer">{footer}</p>}
    </main>
  );
}
