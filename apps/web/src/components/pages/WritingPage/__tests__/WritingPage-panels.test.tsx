import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { expectNoPageA11yViolations } from "../../../../test-support/a11y.ts";
import {
  answerEstimate,
  answerRun,
  answerRunList,
  answerStart,
  makeAnalysis,
  makeEstimate,
  page,
} from "../../../../test-support/analyses-handlers.ts";
import {
  answerOutline,
  itemOf,
  makeDocument,
} from "../../../../test-support/documents-handlers.ts";
import { server } from "../../../../test-support/msw-server.ts";
import { makeProject, problemResponse } from "../../../../test-support/projects-handlers.ts";
import { renderApp } from "../../../../test-support/render-app.tsx";

// The outline and the AI drawer, which open and close with two buttons in the bar at the top.
const PROJECT = makeProject({ id: "project-1", title: "The Lighthouse" });
const ACT = makeDocument({ title: "Act One", content: "Act one text.", wordCount: 3 });
const SCENE = makeDocument({
  title: "The Storm",
  parentId: ACT.id,
  content: "Waves crash.",
  wordCount: 2,
});
const DOCUMENTS = [ACT, SCENE];

function plant() {
  server.use(
    http.get("/projects/:id", () => HttpResponse.json(PROJECT)),
    http.get("/projects/:projectId/documents/:id", ({ params }) => {
      const found = DOCUMENTS.find((document) => document.id === params.id);
      return found ? HttpResponse.json(found) : problemResponse(404, "not-found");
    }),
  );
  answerOutline(DOCUMENTS.map(itemOf));
  const estimates = answerEstimate(makeEstimate());
  const lists = answerRunList(page([]));
  return { estimates, lists };
}

async function openScreen(documentId?: string) {
  const view = renderApp({
    route:
      documentId === undefined
        ? "/app/projects/project-1"
        : `/app/projects/project-1?document=${documentId}`,
    signedIn: true,
  });
  await screen.findByRole("heading", { level: 1, name: "The Lighthouse" });
  return view;
}

const outlineButton = () => screen.getByRole("button", { name: "Outline" });
const aiButton = () => screen.getByRole("button", { name: "AI assistant" });
const aiDrawer = () => document.querySelector<HTMLElement>("aside.drawer");
const outlinePanel = () =>
  document.getElementById(outlineButton().getAttribute("aria-controls") ?? "");

describe("WritingPage: the bar at the top", () => {
  it("has the way back, the title as the one level-one heading, and the two buttons", async () => {
    plant();
    await openScreen();
    expect(screen.getByRole("link", { name: "Back to your projects" })).toHaveAttribute(
      "href",
      "/app",
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(outlineButton()).toBeVisible();
    expect(aiButton()).toBeVisible();
  });

  it("points each button at the panel it controls", async () => {
    plant();
    await openScreen();
    expect(outlinePanel()).not.toBeNull();
    expect(outlinePanel()).toContainElement(screen.getByRole("navigation", { name: "Outline" }));
    expect(aiButton().getAttribute("aria-controls")).toBe(aiDrawer()?.id);
  });
});

describe("WritingPage: the outline panel", () => {
  it("is open to start with", async () => {
    plant();
    await openScreen();
    expect(outlineButton()).toHaveAttribute("aria-expanded", "true");
    expect(outlinePanel()).not.toHaveAttribute("inert");
    expect(screen.getByRole("link", { name: "Act One" })).toBeVisible();
  });

  it("closes and opens with its button, and is out of reach while closed", async () => {
    plant();
    const { user } = await openScreen();
    await user.click(outlineButton());
    expect(outlineButton()).toHaveAttribute("aria-expanded", "false");
    expect(outlinePanel()).toHaveAttribute("inert");
    expect(outlinePanel()).toHaveAttribute("data-open", "false");

    await user.click(outlineButton());
    expect(outlineButton()).toHaveAttribute("aria-expanded", "true");
    expect(outlinePanel()).not.toHaveAttribute("inert");
  });

  it("keeps its place and the open text when it is closed and opened again", async () => {
    plant();
    const { user } = await openScreen(SCENE.id);
    const box = await screen.findByRole("textbox", { name: "Text of “The Storm”" });
    await user.click(outlineButton());
    await user.click(outlineButton());
    expect(screen.getByRole("textbox", { name: "Text of “The Storm”" })).toBe(box);
    expect(screen.getByRole("link", { name: "The Storm" })).toHaveAttribute("aria-current", "page");
  });

  it("is opened again, and takes the focus, when the open item is deleted while it is closed", async () => {
    plant();
    server.use(
      http.delete(
        "/projects/:projectId/documents/:id",
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    const { user } = await openScreen(SCENE.id);
    await screen.findByRole("textbox", { name: "Text of “The Storm”" });
    await user.click(outlineButton());

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete item" }));

    await screen.findByText("Choose an item in the outline to start writing.");
    expect(outlineButton()).toHaveAttribute("aria-expanded", "true");
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2, name: "Outline" })).toHaveFocus(),
    );
  });
});

describe("WritingPage: the AI drawer", () => {
  it("is closed to start with, and nothing about the AI has been asked for", async () => {
    const { estimates, lists } = plant();
    await openScreen();
    expect(aiButton()).toHaveAttribute("aria-expanded", "false");
    expect(aiDrawer()).toHaveAttribute("inert");
    expect(aiDrawer()).toHaveAttribute("data-open", "false");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(estimates).toHaveLength(0);
    expect(lists).toHaveLength(0);
  });

  it("opens with its button, moves the focus to its heading and loads the cost and the history", async () => {
    const { estimates, lists } = plant();
    const { user } = await openScreen();
    await user.click(aiButton());

    expect(aiButton()).toHaveAttribute("aria-expanded", "true");
    expect(aiDrawer()).not.toHaveAttribute("inert");
    expect(screen.getByRole("heading", { level: 2, name: "AI assistant" })).toHaveFocus();
    expect(await screen.findByRole("button", { name: "Run the scan" })).toBeVisible();
    expect(estimates.length).toBeGreaterThan(0);
    expect(lists.length).toBeGreaterThan(0);
  });

  it("does not load the cost and the history again when it is closed and opened again", async () => {
    const { estimates, lists } = plant();
    const { user } = await openScreen();
    await user.click(aiButton());
    await screen.findByRole("button", { name: "Run the scan" });
    const estimatesBefore = estimates.length;
    const listsBefore = lists.length;

    await user.click(screen.getByRole("button", { name: "Close the panel" }));
    await user.click(aiButton());
    await screen.findByRole("button", { name: "Run the scan" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(estimates).toHaveLength(estimatesBefore);
    expect(lists).toHaveLength(listsBefore);
  });

  it("is a landmark named for the assistant", async () => {
    plant();
    const { user } = await openScreen();
    await user.click(aiButton());
    expect(screen.getByRole("complementary", { name: "AI assistant" })).toBeInTheDocument();
  });

  it("closes with Close, and the focus goes back to the button that opened it", async () => {
    plant();
    const { user } = await openScreen();
    await user.click(aiButton());
    await user.click(screen.getByRole("button", { name: "Close the panel" }));
    expect(aiButton()).toHaveAttribute("aria-expanded", "false");
    expect(aiDrawer()).toHaveAttribute("inert");
    expect(aiButton()).toHaveFocus();
  });

  it("closes with Escape from inside it", async () => {
    plant();
    const { user } = await openScreen();
    await user.click(aiButton());
    const run = await screen.findByRole("button", { name: "Run the scan" });
    run.focus();
    await user.keyboard("{Escape}");
    expect(aiDrawer()).toHaveAttribute("inert");
    expect(aiButton()).toHaveFocus();
  });

  it("does not close on Escape in the writing text", async () => {
    plant();
    const { user } = await openScreen(SCENE.id);
    await user.click(aiButton());
    const box = await screen.findByRole("textbox", { name: "Text of “The Storm”" });
    box.focus();
    await user.keyboard("{Escape}");
    expect(aiButton()).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps a run going while it is closed, and shows it again when it is opened", async () => {
    plant();
    const pending = makeAnalysis();
    answerStart(pending);
    answerRun(pending);
    const { user } = await openScreen();
    await user.click(aiButton());
    await user.click(await screen.findByRole("button", { name: "Run the scan" }));
    expect(await screen.findByRole("progressbar")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Close the panel" }));
    expect(aiDrawer()).toHaveAttribute("inert");
    expect(screen.getByRole("progressbar", { hidden: true })).toBeInTheDocument();

    await user.click(aiButton());
    expect(await screen.findByRole("progressbar")).toBeVisible();
  });

  it("opens and closes independently of the outline", async () => {
    plant();
    const { user } = await openScreen();
    await user.click(aiButton());
    await user.click(outlineButton());
    expect(aiButton()).toHaveAttribute("aria-expanded", "true");
    expect(outlineButton()).toHaveAttribute("aria-expanded", "false");
  });
});

describe("WritingPage: the panels and accessibility", () => {
  it("has no violations with the outline open and the drawer closed", async () => {
    plant();
    await openScreen(SCENE.id);
    await screen.findByRole("textbox", { name: "Text of “The Storm”" });
    await expectNoPageA11yViolations();
  });

  it("has no violations with the drawer open, and with the outline closed", async () => {
    plant();
    const { user } = await openScreen(SCENE.id);
    await screen.findByRole("textbox", { name: "Text of “The Storm”" });
    await user.click(aiButton());
    await screen.findByRole("button", { name: "Run the scan" });
    await expectNoPageA11yViolations();
    await user.click(outlineButton());
    await expectNoPageA11yViolations();
  });
});
