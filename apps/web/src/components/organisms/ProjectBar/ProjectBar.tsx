import type { ReactElement, Ref } from "react";
import { Link } from "react-router";
import { Button } from "../../atoms/Button/Button.tsx";
import { Icon } from "../../atoms/Icon/Icon.tsx";
import { PageHeading } from "../../atoms/PageHeading/PageHeading.tsx";
import "./ProjectBar.css";

export interface ProjectBarProps {
  readonly title: string;
  readonly outlineOpen: boolean;
  /** The id of the outline panel, for the button's `aria-controls`. */
  readonly outlineId: string;
  readonly onToggleOutline: () => void;
  readonly aiOpen: boolean;
  /** The id of the AI drawer, for the button's `aria-controls`. */
  readonly aiId: string;
  readonly onToggleAi: () => void;
  /** So that the drawer can give the focus back to this button when it is closed from inside. */
  readonly aiToggleRef: Ref<HTMLButtonElement>;
}

/**
 * The top of the writing screen: the way back, the title of the project (the screen's level-one
 * heading) and the two buttons that show or hide the outline and the AI assistant. Each button says
 * whether what it controls is open, with `aria-expanded`, and which panel it controls.
 */
export function ProjectBar({
  title,
  outlineOpen,
  outlineId,
  onToggleOutline,
  aiOpen,
  aiId,
  onToggleAi,
  aiToggleRef,
}: ProjectBarProps): ReactElement {
  return (
    <div className="project-bar">
      <p className="project-bar__back">
        <Link to="/app">
          <Icon name="arrow-left" />
          Back to your projects
        </Link>
      </p>
      <div className="project-bar__row">
        <PageHeading>{title}</PageHeading>
        <div className="project-bar__tools">
          <Button
            variant="secondary"
            aria-expanded={outlineOpen}
            aria-controls={outlineId}
            onClick={onToggleOutline}
          >
            <Icon name="panel-left" />
            Outline
          </Button>
          <Button
            ref={aiToggleRef}
            aria-expanded={aiOpen}
            aria-controls={aiId}
            onClick={onToggleAi}
          >
            <Icon name="sparkles" />
            AI assistant
          </Button>
        </div>
      </div>
    </div>
  );
}
