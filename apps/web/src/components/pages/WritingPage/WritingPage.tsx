import { type ReactElement, useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { DocumentDetail } from "../../../lib/api/documents-api.ts";
import { findNode, type OutlineNode, useOutline } from "../../../lib/documents/use-outline.ts";
import { usePageTitle } from "../../../lib/navigation/use-page-title.ts";
import { useProject } from "../../../lib/projects/use-project.ts";
import { Button } from "../../atoms/Button/Button.tsx";
import { PageHeading } from "../../atoms/PageHeading/PageHeading.tsx";
import { Drawer } from "../../molecules/Drawer/Drawer.tsx";
import { ErrorSummary } from "../../molecules/ErrorSummary/ErrorSummary.tsx";
import { AddItemForm } from "../../organisms/AddItemForm/AddItemForm.tsx";
import { AiPanel } from "../../organisms/AiPanel/AiPanel.tsx";
import { DocumentEditor } from "../../organisms/DocumentEditor/DocumentEditor.tsx";
import { OutlineNav } from "../../organisms/OutlineNav/OutlineNav.tsx";
import { ProjectBar } from "../../organisms/ProjectBar/ProjectBar.tsx";
import { AppLayout } from "../../templates/AppLayout/AppLayout.tsx";
import "./WritingPage.css";

/** The title of every item in the outline, by id. */
function titlesOf(nodes: readonly OutlineNode[]): ReadonlyMap<string, string> {
  const titles = new Map<string, string>();
  for (const node of nodes) {
    titles.set(node.id, node.title);
    for (const child of node.children) titles.set(child.id, child.title);
  }
  return titles;
}

/**
 * The writing screen of one project: its outline beside the text of the open item, and the AI
 * assistant in a drawer on the other side. The outline and the drawer each open and close with a
 * button in the bar at the top. The open item is in the address (`?document=<id>`), so Back works
 * and a link leads straight to a scene. Choosing an item, or adding one, moves the focus into its
 * text.
 */
export function WritingPage(): ReactElement {
  const { projectId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const documentId = searchParams.get("document") ?? undefined;
  const { load: project, retry: retryProject } = useProject(projectId);
  const outline = useOutline(projectId);
  // The item the writer chose or added on this screen: its text takes the focus when it has loaded.
  // (An item opened by the address alone, such as after a reload, does not take it.)
  const [chosenId, setChosenId] = useState<string | undefined>(undefined);
  // Counts the links in AI findings that were pressed. A link to the item that is already open
  // changes nothing else on the screen, so the text is told to take the focus by this number.
  const [focusSignal, setFocusSignal] = useState(0);
  const outlineHeadingRef = useRef<HTMLHeadingElement | null>(null);
  // The outline starts open and the AI drawer starts closed. Neither is remembered: only the colour
  // theme is kept between visits.
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [aiOpen, setAiOpen] = useState(false);
  const aiToggleRef = useRef<HTMLButtonElement | null>(null);
  const panelIds = useId();
  const outlineId = `${panelIds}-outline`;
  const aiId = `${panelIds}-ai`;
  // A deleted item leaves the focus nowhere; it goes to the outline's heading, which has to be open
  // for that. If it was closed it is opened first, and the focus follows once it can take it.
  const focusOutlineWhenOpen = useRef(false);
  useEffect(() => {
    if (outlineOpen && focusOutlineWhenOpen.current) {
      focusOutlineWhenOpen.current = false;
      outlineHeadingRef.current?.focus();
    }
  }, [outlineOpen]);
  // What a screen reader is told after a rename, a move or a delete. It is kept here, not in the
  // toolbar, because a deleted item takes its toolbar away with it.
  const [announcement, setAnnouncement] = useState({ text: "", serial: 0 });
  const announce = useCallback((text: string): void => {
    setAnnouncement((previous) => ({ text, serial: previous.serial + 1 }));
  }, []);

  usePageTitle(project.status === "ready" ? project.project.title : "Writing");

  const back = (
    <p className="writing-page__back">
      <Link to="/app">Back to your projects</Link>
    </p>
  );

  if (project.status === "loading") {
    return (
      <AppLayout wide>
        {back}
        <PageHeading>Opening your project</PageHeading>
        <p role="status">Loading…</p>
      </AppLayout>
    );
  }

  if (project.status === "failed") {
    return (
      <AppLayout wide>
        {back}
        <PageHeading>
          {project.notFound ? "Project not found" : "Could not open the project"}
        </PageHeading>
        <div className="writing-page__problem">
          <ErrorSummary items={[{ message: project.message }]} />
          {project.notFound ? null : <Button onClick={retryProject}>Try again</Button>}
        </div>
      </AppLayout>
    );
  }

  // The open item is gone: close it, and put the focus on the outline, the next place to work from.
  const handleDeleted = (): void => {
    setChosenId(undefined);
    setSearchParams({}, { replace: true });
    if (outlineOpen) {
      outlineHeadingRef.current?.focus();
    } else {
      focusOutlineWhenOpen.current = true;
      setOutlineOpen(true);
    }
  };

  // A link in an AI finding opens its item (the link changes the address). The text of an item that
  // has to load takes the focus when it is ready; one that is open already is told by the signal.
  const handleFindingLink = (id: string): void => {
    setChosenId(id);
    setFocusSignal((count) => count + 1);
  };

  const handleAdded = (document: DocumentDetail): void => {
    outline.add(document);
    setChosenId(document.id);
    setSearchParams({ document: document.id });
  };

  const nodes = outline.view.status === "ready" ? outline.view.nodes : [];
  const open = documentId === undefined ? undefined : findNode(nodes, documentId);
  // Not a hook: this comes after the early returns above, and building the map is cheap.
  const titles = titlesOf(nodes);
  // A scene goes into the act that is open, or into the act the open scene is in.
  const insideNode = open === undefined ? undefined : (open.parent ?? open.node);
  const inside =
    insideNode === undefined ? undefined : { id: insideNode.id, title: insideNode.title };

  let side: ReactElement;
  if (outline.view.status === "loading") {
    side = <p role="status">Loading the outline…</p>;
  } else if (outline.view.status === "failed") {
    side = (
      <div className="writing-page__problem">
        <ErrorSummary items={[{ message: outline.view.message }]} />
        <Button onClick={outline.retry}>Try again</Button>
      </div>
    );
  } else {
    side = (
      <>
        <OutlineNav
          nodes={nodes}
          selectedId={documentId}
          onSelect={setChosenId}
          headingRef={outlineHeadingRef}
        />
        <AddItemForm projectId={projectId} inside={inside} onAdded={handleAdded} />
      </>
    );
  }

  let text: ReactElement | null = null;
  if (outline.view.status === "ready") {
    if (documentId === undefined) {
      text = (
        <p className="writing-page__prompt">
          {nodes.length === 0
            ? "Add an act or a chapter to start writing."
            : "Choose an item in the outline to start writing."}
        </p>
      );
    } else if (open === undefined) {
      text = (
        <p className="writing-page__prompt">
          That item is not in this project's outline. Choose one from the outline.
        </p>
      );
    } else {
      text = (
        <DocumentEditor
          key={open.node.id}
          projectId={projectId}
          item={{ id: open.node.id, title: open.node.title }}
          focusOnReady={chosenId === open.node.id}
          focusSignal={focusSignal}
          onWordCount={outline.setWordCount}
          itemActions={{
            nodes,
            refresh: outline.refresh,
            onDeleted: handleDeleted,
            announce,
          }}
        />
      );
    }
  }

  return (
    <AppLayout wide>
      <ProjectBar
        title={project.project.title}
        outlineOpen={outlineOpen}
        outlineId={outlineId}
        onToggleOutline={() => {
          setOutlineOpen((previous) => !previous);
        }}
        aiOpen={aiOpen}
        aiId={aiId}
        onToggleAi={() => {
          setAiOpen((previous) => !previous);
        }}
        aiToggleRef={aiToggleRef}
      />
      <div
        className="writing-page__panes"
        data-outline={outlineOpen ? "open" : "closed"}
        data-ai={aiOpen ? "open" : "closed"}
      >
        <div
          id={outlineId}
          className="writing-page__side"
          data-open={outlineOpen ? "true" : "false"}
          inert={!outlineOpen}
        >
          <div className="writing-page__side-inner">{side}</div>
        </div>
        <div className="writing-page__text">{text}</div>
        <div className="writing-page__ai">
          <Drawer
            id={aiId}
            open={aiOpen}
            title="AI assistant"
            returnFocusRef={aiToggleRef}
            onClose={() => {
              setAiOpen(false);
            }}
          >
            <AiPanel
              projectId={projectId}
              open={aiOpen}
              openItem={
                open === undefined ? undefined : { id: open.node.id, title: open.node.title }
              }
              titles={titles}
              onOpenItem={handleFindingLink}
            />
          </Drawer>
        </div>
      </div>
      {/* Always in the page, so that a screen reader is already listening when its text changes. */}
      <p role="status" className="visually-hidden">
        {announcement.text === ""
          ? ""
          : announcement.text + (announcement.serial % 2 === 0 ? "\u00a0" : "")}
      </p>
    </AppLayout>
  );
}
