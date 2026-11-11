import type { ReactElement } from "react";
import { usePageTitle } from "../../../lib/navigation/use-page-title.ts";
import { useProjects } from "../../../lib/projects/use-projects.ts";
import { PageHeading } from "../../atoms/PageHeading/PageHeading.tsx";
import { CreateProjectForm } from "../../organisms/CreateProjectForm/CreateProjectForm.tsx";
import { ProjectList } from "../../organisms/ProjectList/ProjectList.tsx";
import { AppLayout } from "../../templates/AppLayout/AppLayout.tsx";
import "./AppHomePage.css";

/**
 * The signed-in home: a form for a new project, and the person's projects below it. A project
 * created here is added to the list at once, without loading the list again.
 */
export function AppHomePage(): ReactElement {
  usePageTitle("Your projects");
  const { view, retry, loadMore, add } = useProjects();

  return (
    <AppLayout>
      <PageHeading>Your projects</PageHeading>
      <section className="projects-page__section" aria-labelledby="new-project-heading">
        <h2 id="new-project-heading">Start a new project</h2>
        <CreateProjectForm onCreated={add} />
      </section>
      <section className="projects-page__section" aria-labelledby="project-list-heading">
        <h2 id="project-list-heading">All your projects</h2>
        <ProjectList view={view} onRetry={retry} onLoadMore={loadMore} />
      </section>
    </AppLayout>
  );
}
