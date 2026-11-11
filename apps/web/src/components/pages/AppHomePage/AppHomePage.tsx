import type { ReactElement } from "react";
import { usePageTitle } from "../../../lib/navigation/use-page-title.ts";
import { useProjects } from "../../../lib/projects/use-projects.ts";
import { PageHeading } from "../../atoms/PageHeading/PageHeading.tsx";
import { CreateProjectForm } from "../../organisms/CreateProjectForm/CreateProjectForm.tsx";
import { ProjectList } from "../../organisms/ProjectList/ProjectList.tsx";
import { AppLayout } from "../../templates/AppLayout/AppLayout.tsx";
import "./AppHomePage.css";

const LIST_HEADING_ID = "project-list-heading";

/**
 * The signed-in home: a form for a new project, and the person's projects below it, each of which
 * can be changed or deleted. A project created or changed here is shown at the top of the list at
 * once, without loading the list again.
 */
export function AppHomePage(): ReactElement {
  usePageTitle("Your projects");
  const { view, retry, loadMore, add, replace, remove, announce } = useProjects();

  return (
    <AppLayout>
      <PageHeading>Your projects</PageHeading>
      <section className="projects-page__section" aria-labelledby="new-project-heading">
        <h2 id="new-project-heading">Start a new project</h2>
        <CreateProjectForm onCreated={add} />
      </section>
      <section className="projects-page__section" aria-labelledby={LIST_HEADING_ID}>
        {/* It can be focused by code: after the last project is deleted the focus comes here. */}
        <h2 id={LIST_HEADING_ID} tabIndex={-1} className="projects-page__list-heading">
          All your projects
        </h2>
        <ProjectList
          view={view}
          onRetry={retry}
          onLoadMore={loadMore}
          headingId={LIST_HEADING_ID}
          onSaved={(project) => {
            replace(project, `Project “${project.title}” saved.`);
          }}
          onUnchanged={() => {
            announce("No changes to save.");
          }}
          onDeleted={(project) => {
            remove(project.id, `Project “${project.title}” deleted.`);
          }}
        />
      </section>
    </AppLayout>
  );
}
