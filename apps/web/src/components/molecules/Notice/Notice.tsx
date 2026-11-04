import type { ReactElement, ReactNode } from "react";
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
      {children}
    </div>
  );
}
