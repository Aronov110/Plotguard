import { type ReactElement, useEffect, useRef, useState } from "react";
import type { Project } from "../../../lib/api/projects-api.ts";
import { useDeleteProject } from "../../../lib/projects/use-delete-project.ts";
import { Button } from "../../atoms/Button/Button.tsx";
import { DeleteConfirmation } from "../../molecules/DeleteConfirmation/DeleteConfirmation.tsx";
import { ProjectListItem } from "../../molecules/ProjectListItem/ProjectListItem.tsx";
import { ProjectSummary } from "../../molecules/ProjectSummary/ProjectSummary.tsx";
import { EditProjectForm } from "../EditProjectForm/EditProjectForm.tsx";
import "./ProjectEntry.css";

type Mode = "viewing" | "editing" | "confirming-delete";

/** The address of a project's writing screen. */
function writingPath(projectId: string): string {
  return `/app/projects/${encodeURIComponent(projectId)}`;
}

export interface ProjectEntryProps {
  readonly project: Project;
  /** Called with the project as saved. The list shows it at the top. */
  readonly onSaved: (project: Project) => void;
  /** Called when Save was pressed with nothing changed. */
  readonly onUnchanged: () => void;
  /** Called once the project no longer exists. The list takes the card out and moves the focus. */
  readonly onDeleted: (project: Project) => void;
}

/**
 * One project in the list, which can show its details, a form to change them, or the question
 * before deleting it. Each card has its own state, so several can be open at once.
 *
 * The focus never gets lost: opening the form goes to the title, opening the question goes to
 * "Keep project", and closing either goes back to the button that opened it.
 */
export function ProjectEntry({
  project,
  onSaved,
  onUnchanged,
  onDeleted,
}: ProjectEntryProps): ReactElement {
  const [mode, setMode] = useState<Mode>("viewing");
  const editRef = useRef<HTMLButtonElement | null>(null);
  const deleteRef = useRef<HTMLButtonElement | null>(null);
  const keepRef = useRef<HTMLButtonElement | null>(null);
  // Which button gets the focus back when the card shows its details again.
  const returnTo = useRef<"edit" | "delete" | undefined>(undefined);

  const remove = useDeleteProject(project.id, () => {
    onDeleted(project);
  });

  useEffect(() => {
    if (mode === "viewing" && returnTo.current !== undefined) {
      (returnTo.current === "edit" ? editRef : deleteRef).current?.focus();
      returnTo.current = undefined;
    }
    if (mode === "confirming-delete") keepRef.current?.focus();
  }, [mode]);

  const backToDetails = (focus: "edit" | "delete"): void => {
    returnTo.current = focus;
    setMode("viewing");
  };

  if (mode === "editing") {
    return (
      <ProjectListItem projectId={project.id}>
        <EditProjectForm
          project={project}
          onSaved={(saved) => {
            backToDetails("edit");
            onSaved(saved);
          }}
          onUnchanged={() => {
            backToDetails("edit");
            onUnchanged();
          }}
          onCancel={() => {
            backToDetails("edit");
          }}
        />
      </ProjectListItem>
    );
  }

  return (
    <ProjectListItem projectId={project.id}>
      <ProjectSummary project={project} to={writingPath(project.id)} />
      {mode === "confirming-delete" ? (
        <DeleteConfirmation
          projectTitle={project.title}
          busy={remove.busy}
          error={remove.error}
          onConfirm={remove.confirm}
          onCancel={() => {
            remove.forgetError();
            backToDetails("delete");
          }}
          keepRef={keepRef}
        />
      ) : (
        <div className="project-entry__actions">
          <Button
            variant="secondary"
            ref={editRef}
            onClick={() => {
              setMode("editing");
            }}
          >
            {/* The space is outside the span: some accessible-name algorithms drop one at its start. */}
            Edit <span className="visually-hidden">project “{project.title}”</span>
          </Button>
          <Button
            variant="secondary"
            ref={deleteRef}
            onClick={() => {
              setMode("confirming-delete");
            }}
          >
            Delete <span className="visually-hidden">project “{project.title}”</span>
          </Button>
        </div>
      )}
    </ProjectListItem>
  );
}
