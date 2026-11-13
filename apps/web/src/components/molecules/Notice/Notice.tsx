import type { ReactElement, ReactNode } from "react";
import { Icon } from "../../atoms/Icon/Icon.tsx";
import "./Notice.css";

export interface NoticeProps {
  /** `warning` asks for attention; `info` just informs. */
  readonly tone?: "warning" | "info";
  readonly children: ReactNode;
}

/** A short message that is read out politely when it appears, and can hold a button or a link. */
export function Notice({ tone = "warning", children }: NoticeProps): ReactElement {
  return (
    <div role="status" className={`notice notice--${tone}`}>
      <span className="notice__icon">
        <Icon name="alert" />
      </span>
      <div className="notice__body">{children}</div>
    </div>
  );
}
