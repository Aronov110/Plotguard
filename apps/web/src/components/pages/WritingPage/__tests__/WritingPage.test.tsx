import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import type { DocumentDetail } from "../../../../lib/api/documents-api.ts";
import { expectNoPageA11yViolations } from "../../../../test-support/a11y.ts";
import {
  answerCreateDocument,
  answerOutline,
  answerSave,
  createdDocument,
  itemOf,
  makeDocument,
  saved,
} from "../../../../test-support/documents-handlers.ts";
import { server } from "../../../../test-support/msw-server.ts";
import { makeProject, problemResponse } from "../../../../test-support/projects-handlers.ts";
import { renderApp } from "../../../../test-support/render-app.tsx";

const PROJECT = makeProject({ id: "project-1", title: "The Lighthouse" });

interface Setup {
  readonly documents?: readonly DocumentDetail[];
  readonly project?: () => Response | Promise<Response>;
}

/** Plants the fake API for one project: the project, its outline and the documents' texts. */
function plant({ documents = [], project }: Setup = {}) {
  server.use(
    http.get("/projects/:id", () => (project ? project() : HttpResponse.json(PROJECT))),
    http.get("/projects/:projectId/documents/:id", ({ params }) => {
      const found = documents.find((document) => document.id === params.id);
      return found ? HttpResponse.json(found) : problemResponse(404, "not-found");
    }),
  );
  return answerOutline(documents.map(itemOf));
}

async function openProject(query = "", options: Parameters<typeof renderApp>[0] = {}) {
  const view = renderApp({ route: `/app/projects/project-1${query}`, signedIn: true, ...options });
  await screen.findByRole("heading", { level: 1, name: "The Lighthouse" });
  return view;
}

const ACT = makeDocument({ title: "Act One", content: "Act one text.", wordCount: 3 });
const SCENE = makeDocument({
  title: "The Storm",
  parentId: ACT.id,
  content: "Waves crash.",
  wordCount: 2,
});
const ACT_TWO = makeDocument({ title: "Act Two", content: "", wordCount: 0 });
const DOCUMENTS = [ACT, SCENE, ACT_TWO];

const outlineNav = () => screen.getByRole("navigation", { name: "Outline" });

describe("WritingPage: the frame", () => {
  it("is titled with the project, in the page and in the tab, with a way back", async () => {
    plant();
    await openProject();
    expect(screen.getByRole("heading", { level: 1, name: "The Lighthouse" })).toBeVisible();
    expect(document.title).toBe("The Lighthouse – Plotpal");
    expect(screen.getByRole("link", { name: "Back to your projects" })).toHaveAttribute(
      "href",
      "/app",
    );
  });

  it("is not shown to someone who is signed out", async () => {
    plant();
    renderApp({ route: "/app/projects/project-1" });
    expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
    expect(screen.queryByText("The Lighthouse")).not.toBeInTheDocument();
  });

  it("says that the project is not there after a 404, without a Try again button", async () => {
    plant({ project: () => problemResponse(404, "not-found") });
    renderApp({ route: "/app/projects/project-1", signedIn: true });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Project not found" }),
    ).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This project does not exist, or it is not yours.",
    );
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to your projects" })).toBeVisible();
  });

  it("offers Try again when the project could not be reached, and then opens it", async () => {
    let calls = 0;
    plant({
      project: () => {
        calls += 1;
        return calls === 1 ? HttpResponse.error() : HttpResponse.json(PROJECT);
      },
    });
    const { user } = renderApp({ route: "/app/projects/project-1", signedIn: true });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Could not open the project" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "The Lighthouse" })).toBeVisible();
  });
});

describe("WritingPage: the outline", () => {
  it("shows the outline with scenes inside their act, and asks to choose an item", async () => {
    plant({ documents: DOCUMENTS });
    await openProject();
    await within(outlineNav()).findByRole("link", { name: "Act One" });

    expect(
      within(outlineNav())
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Act One", "The Storm", "Act Two"]);
    expect(screen.getByText("Choose an item in the outline to start writing.")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: /Text of/ })).not.toBeInTheDocument();
  });

  it("says how to start for a project without items", async () => {
    plant();
    await openProject();
    expect(await screen.findByText("Add an act or a chapter to start writing.")).toBeVisible();
    expect(screen.getByText(/This project has no outline yet/)).toBeVisible();
  });

  it("says why the outline could not be loaded, and loads it on Try again", async () => {
    plant();
    const calls = answerOutline(() => HttpResponse.error(), [itemOf(ACT)]);
    const { user } = await openProject();
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await within(outlineNav()).findByRole("link", { name: "Act One" })).toBeVisible();
    expect(calls).toHaveLength(2);
  });
});

describe("WritingPage: opening a document", () => {
  it("opens the chosen item's text, with the focus in the box and the item marked as current", async () => {
    plant({ documents: DOCUMENTS });
    const { user } = await openProject();
    await user.click(await within(outlineNav()).findByRole("link", { name: "The Storm" }));

    const box = await screen.findByRole("textbox", { name: "Text of “The Storm”" });
    expect(box).toHaveValue("Waves crash.");
    await waitFor(() => expect(box).toHaveFocus());
    expect(screen.getByRole("heading", { level: 2, name: "The Storm" })).toBeVisible();
    expect(within(outlineNav()).getByRole("link", { name: "The Storm" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("2 words", { selector: "p" })).toBeVisible();
  });

  it("opens the item named in the address, without taking the focus", async () => {
    plant({ documents: DOCUMENTS });
    await openProject(`?document=${SCENE.id}`);
    const box = await screen.findByRole("textbox", { name: "Text of “The Storm”" });
    expect(box).toHaveValue("Waves crash.");
    expect(box).not.toHaveFocus();
    expect(within(outlineNav()).getByRole("link", { name: "The Storm" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("says so when the address names an item that is not in the outline", async () => {
    plant({ documents: DOCUMENTS });
    await openProject("?document=nothing-like-it");
    expect(await screen.findByText(/That item is not in this project's outline/)).toBeVisible();
    expect(screen.queryByRole("textbox", { name: /Text of/ })).not.toBeInTheDocument();
  });

  it("switches to another item, saving the text of the first one first", async () => {
    plant({ documents: DOCUMENTS });
    const calls = answerSave(saved(ACT));
    const { user } = await openProject(`?document=${ACT.id}`);
    const box = await screen.findByRole("textbox", { name: "Text of “Act One”" });

    fireEvent.input(box, { target: { value: "Act one text, edited." } });
    await user.click(within(outlineNav()).getByRole("link", { name: "Act Two" }));

    await screen.findByRole("textbox", { name: "Text of “Act Two”" });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.id).toBe(ACT.id);
    expect(calls[0]?.body).toEqual({ content: "Act one text, edited." });
  });

  it("shows the new word count in the outline after a save", async () => {
    plant({ documents: [ACT] });
    answerSave(saved(ACT));
    await openProject(`?document=${ACT.id}`);
    const box = await screen.findByRole("textbox", { name: "Text of “Act One”" });
    expect(within(outlineNav()).getByText("3 words")).toBeVisible();

    fireEvent.input(box, { target: { value: "one two three four five" } });
    fireEvent.blur(box);

    await waitFor(() => expect(within(outlineNav()).getByText("5 words")).toBeVisible());
  });
});

describe("WritingPage: adding", () => {
  it("adds an act at the top level when nothing is open, opens it, and focuses its text", async () => {
    const created = makeDocument({ title: "Act One" });
    // The new document can be read once it exists, but the outline starts empty.
    plant({ documents: [created] });
    answerOutline([]);
    const calls = answerCreateDocument(createdDocument({ id: created.id }));
    const { user } = await openProject();
    await screen.findByText("Add an act or a chapter to start writing.");

    await user.type(screen.getByLabelText("Title"), "Act One");
    await user.click(screen.getByRole("button", { name: "Add to the outline" }));

    const box = await screen.findByRole("textbox", { name: "Text of “Act One”" });
    await waitFor(() => expect(box).toHaveFocus());
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ title: "Act One" });
    expect(within(outlineNav()).getByRole("link", { name: "Act One" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("adds a scene inside the open act, shown under it", async () => {
    plant({ documents: [ACT] });
    const scene = makeDocument({ title: "New scene", parentId: ACT.id });
    const calls = answerCreateDocument(createdDocument({ id: scene.id }));
    const { user } = await openProject(`?document=${ACT.id}`);
    await screen.findByRole("textbox", { name: "Text of “Act One”" });
    expect(screen.getByRole("radio", { name: "Inside “Act One”" })).toBeChecked();

    await user.type(screen.getByLabelText("Title"), "New scene");
    await user.click(screen.getByRole("button", { name: "Add to the outline" }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toEqual({ title: "New scene", parentId: ACT.id });
    await within(outlineNav()).findByRole("link", { name: "New scene" });
    expect(
      within(outlineNav())
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Act One", "New scene"]);
  });

  it("offers the act that the open scene is in", async () => {
    plant({ documents: DOCUMENTS });
    await openProject(`?document=${SCENE.id}`);
    expect(await screen.findByRole("radio", { name: "Inside “Act One”" })).toBeChecked();
  });

  it("says why an item could not be added, and keeps the outline as it was", async () => {
    plant({ documents: [ACT] });
    answerCreateDocument(() => problemResponse(409, "conflict"));
    const { user } = await openProject();
    await within(outlineNav()).findByRole("link", { name: "Act One" });
    await user.type(screen.getByLabelText("Title"), "One too many");
    await user.click(screen.getByRole("button", { name: "Add to the outline" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The outline is full");
    expect(within(outlineNav()).getAllByRole("link")).toHaveLength(1);
  });
});

describe("WritingPage: accessibility", () => {
  it("has no violations with an item open", async () => {
    plant({ documents: DOCUMENTS });
    await openProject(`?document=${SCENE.id}`);
    await screen.findByRole("textbox", { name: "Text of “The Storm”" });
    await expectNoPageA11yViolations();
  });

  it("has no violations with nothing open, with an empty outline, and when the project is missing", async () => {
    plant({ documents: DOCUMENTS });
    const first = await openProject();
    await screen.findByText("Choose an item in the outline to start writing.");
    await expectNoPageA11yViolations();
    first.unmount();

    plant();
    await openProject();
    await screen.findByText("Add an act or a chapter to start writing.");
    await expectNoPageA11yViolations();
  });

  it("has no violations when the project cannot be opened", async () => {
    plant({ project: () => problemResponse(404, "not-found") });
    renderApp({ route: "/app/projects/project-1", signedIn: true });
    await screen.findByRole("heading", { level: 1, name: "Project not found" });
    await expectNoPageA11yViolations();
  });
});
