import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import type { DocumentDetail } from "../../../../lib/api/documents-api.ts";
import { expectNoPageA11yViolations } from "../../../../test-support/a11y.ts";
import {
  answerOutline,
  answerSave,
  itemOf,
  makeDocument,
  saved,
} from "../../../../test-support/documents-handlers.ts";
import { server } from "../../../../test-support/msw-server.ts";
import { makeProject, problemResponse } from "../../../../test-support/projects-handlers.ts";
import { renderApp } from "../../../../test-support/render-app.tsx";

/**
 * Whole-page tests with several steps (or axe, four times): about a second on a quiet machine, but
 * on a very busy one they can pass the 5-second default, which then says nothing about the app.
 */
const HEAVY_TEST_TIMEOUT_MS = 15_000;

const PROJECT = makeProject({ id: "project-1", title: "The Lighthouse" });

const ACT = makeDocument({ title: "Act One", content: "Act one text.", wordCount: 3, position: 0 });
const STORM = makeDocument({
  title: "The Storm",
  parentId: ACT.id,
  content: "Waves crash.",
  wordCount: 2,
  position: 0,
});
const CALM = makeDocument({
  title: "The Calm",
  parentId: ACT.id,
  content: "Still water.",
  wordCount: 2,
  position: 1,
});
const ACT_TWO = makeDocument({ title: "Act Two", content: "", wordCount: 0, position: 1 });
const DOCUMENTS = [ACT, STORM, CALM, ACT_TWO];

const outlineNav = () => screen.getByRole("navigation", { name: "Outline" });
const linkTitles = () =>
  within(outlineNav())
    .getAllByRole("link")
    .map((link) => link.textContent);

/**
 * Plants the fake API: the project, the texts, the outline as it is first, and the outline as it is
 * after the change under test (the second outline request, which is the page reading it again).
 */
function plant(after: readonly DocumentDetail[] = DOCUMENTS) {
  server.use(
    http.get("/projects/:id", () => HttpResponse.json(PROJECT)),
    http.get("/projects/:projectId/documents/:id", ({ params }) => {
      const found = DOCUMENTS.find((document) => document.id === params.id);
      return found ? HttpResponse.json(found) : problemResponse(404, "not-found");
    }),
  );
  return answerOutline(DOCUMENTS.map(itemOf), after.map(itemOf));
}

function answerDelete() {
  const calls: string[] = [];
  server.use(
    http.delete("/projects/:projectId/documents/:id", ({ params }) => {
      calls.push(String(params.id));
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return calls;
}

/** Answers every save with the stored document and the version after the one sent. */
function answerEverySave() {
  return answerSave((call) => {
    const found = DOCUMENTS.find((document) => document.id === call.id);
    if (found === undefined) return problemResponse(404, "not-found");
    return saved(found)(call);
  });
}

async function openScene(scene: DocumentDetail) {
  const view = renderApp({
    route: `/app/projects/project-1?document=${scene.id}`,
    signedIn: true,
  });
  await screen.findByRole("heading", { level: 1, name: "The Lighthouse" });
  await screen.findByRole("textbox", { name: `Text of “${scene.title}”` });
  return view;
}

const button = (name: string) => screen.getByRole("button", { name });

describe("WritingPage: the item toolbar", () => {
  it("is above the text of the open item, named after it", async () => {
    plant();
    await openScene(STORM);
    expect(screen.getByRole("group", { name: "Actions for “The Storm”" })).toBeVisible();
    expect(button("Rename")).toBeVisible();
  });

  it("is not there when nothing is open", async () => {
    plant();
    renderApp({ route: "/app/projects/project-1", signedIn: true });
    await screen.findByText("Choose an item in the outline to start writing.");
    expect(screen.queryByRole("group", { name: /Actions for/ })).not.toBeInTheDocument();
  });
});

describe("WritingPage: renaming", () => {
  it("shows the new title in the outline, the heading and the label of the text, and keeps the text", async () => {
    const renamed = { ...STORM, title: "The Tempest" };
    plant([ACT, renamed, CALM, ACT_TWO]);
    const calls = answerEverySave();
    const { user } = await openScene(STORM);

    await user.click(button("Rename"));
    await user.keyboard("The Tempest{Enter}");

    await within(outlineNav()).findByRole("link", { name: "The Tempest" });
    expect(calls[0]?.body).toEqual({ title: "The Tempest" });
    expect(screen.getByRole("heading", { level: 2, name: "The Tempest" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Text of “The Tempest”" })).toHaveValue(
      "Waves crash.",
    );
    expect(screen.getByRole("group", { name: "Actions for “The Tempest”" })).toBeVisible();
    expect(button("Rename")).toHaveFocus();
  });

  it("tells a screen reader about it, in a place that stays", async () => {
    plant([ACT, { ...STORM, title: "The Tempest" }, CALM, ACT_TWO]);
    answerEverySave();
    const { user } = await openScene(STORM);
    await user.click(button("Rename"));
    await user.keyboard("The Tempest{Enter}");
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("status")
          .some((status) => /Renamed to “The Tempest”\./.test(status.textContent)),
      ).toBe(true),
    );
  });

  it(
    "saves text typed before the rename first, and the next text save follows the rename without a conflict",
    async () => {
      plant([ACT, { ...STORM, title: "The Tempest" }, CALM, ACT_TWO]);
      const calls = answerEverySave();
      const { user } = await openScene(STORM);

      await user.type(screen.getByRole("textbox", { name: "Text of “The Storm”" }), " More waves.");
      await user.click(button("Rename"));
      await user.keyboard("The Tempest{Enter}");
      await within(outlineNav()).findByRole("link", { name: "The Tempest" });

      // The text went first, on version 1; the rename went on the version that save returned.
      expect(calls.map((call) => call.body)).toEqual([
        { content: "Waves crash. More waves." },
        { title: "The Tempest" },
      ]);
      expect(calls.map((call) => call.ifMatch)).toEqual(['"1"', '"2"']);

      // Writing on afterwards starts from the rename's version: no conflict with the writer's own change.
      const box = screen.getByRole("textbox", { name: "Text of “The Tempest”" });
      await user.type(box, " Still more.");
      fireEvent.keyDown(box, { key: "s", ctrlKey: true });
      await waitFor(() => expect(calls).toHaveLength(3));
      expect(calls[2]?.ifMatch).toBe('"3"');
      expect(calls[2]?.body).toEqual({ content: "Waves crash. More waves. Still more." });
      await waitFor(() => expect(screen.getByText("Saved")).toBeVisible());
      expect(
        screen.queryByRole("button", { name: "Save my text over theirs" }),
      ).not.toBeInTheDocument();
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  it("keeps the old title and says why when the title is refused", async () => {
    plant();
    answerSave(() =>
      problemResponse(400, "validation", {
        errors: [{ pointer: "/title", message: "The title can be at most 200 characters." }],
      }),
    );
    const { user } = await openScene(STORM);
    await user.click(button("Rename"));
    await user.keyboard("x{Enter}");

    expect(await screen.findAllByRole("alert")).not.toHaveLength(0);
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent(
      "The title can be at most 200 characters.",
    );
    expect(linkTitles()).toContain("The Storm");
    expect(screen.getByRole("heading", { level: 2, name: "The Storm" })).toBeVisible();
  });
});

describe("WritingPage: moving", () => {
  it("shows the new order after Move up, keeps the item open, and says where it is", async () => {
    const swapped = [ACT, { ...CALM, position: 0 }, { ...STORM, position: 1 }, ACT_TWO];
    plant(swapped);
    const calls = answerEverySave();
    const { user } = await openScene(CALM);
    expect(linkTitles()).toEqual(["Act One", "The Storm", "The Calm", "Act Two"]);

    await user.click(button("Move up"));

    await waitFor(() =>
      expect(linkTitles()).toEqual(["Act One", "The Calm", "The Storm", "Act Two"]),
    );
    expect(calls[0]?.body).toEqual({ position: 0 });
    expect(screen.getByRole("textbox", { name: "Text of “The Calm”" })).toHaveValue("Still water.");
    expect(within(outlineNav()).getByRole("link", { name: "The Calm" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("status")
          .some((status) =>
            /“The Calm” moved\. It is now 1 of 2 in “Act One”\./.test(status.textContent),
          ),
      ).toBe(true),
    );
    expect(button("Move up")).toHaveFocus();
  });

  it("moves a scene into another act with Move to…, and the scene stays open", async () => {
    const moved = { ...CALM, parentId: ACT_TWO.id, position: 0 };
    plant([ACT, STORM, ACT_TWO, moved]);
    const calls = answerEverySave();
    const { user } = await openScene(CALM);

    await user.click(button("Move to…"));
    await user.selectOptions(screen.getByRole("combobox", { name: "Move to" }), ACT_TWO.id);
    await user.click(button("Move"));

    await waitFor(() =>
      expect(linkTitles()).toEqual(["Act One", "The Storm", "Act Two", "The Calm"]),
    );
    expect(calls[0]?.body).toEqual({ parentId: ACT_TWO.id });
    expect(screen.getByRole("textbox", { name: "Text of “The Calm”" })).toBeVisible();
    // The scene is now in Act Two, so Add to the outline offers that act.
    expect(await screen.findByRole("radio", { name: "Inside “Act Two”" })).toBeChecked();
    expect(button("Move to…")).toHaveFocus();
  });

  it(
    "moves a scene out to the top level",
    async () => {
      plant([ACT, STORM, ACT_TWO, { ...CALM, parentId: null, position: 2 }]);
      const calls = answerEverySave();
      const { user } = await openScene(CALM);
      await user.click(button("Move to…"));
      await user.selectOptions(screen.getByRole("combobox", { name: "Move to" }), "top");
      await user.click(button("Move"));
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]?.body).toEqual({ parentId: null });
      await waitFor(() =>
        expect(linkTitles()).toEqual(["Act One", "The Storm", "Act Two", "The Calm"]),
      );
      // At the top level the scene is its own act now, so Add to the outline offers it.
      expect(await screen.findByRole("radio", { name: "Inside “The Calm”" })).toBeChecked();
    },
    HEAVY_TEST_TIMEOUT_MS,
  );
});

describe("WritingPage: deleting", () => {
  it("removes the item, closes its text, puts the focus on the outline and says so", async () => {
    plant([ACT, CALM, ACT_TWO]);
    const deleted = answerDelete();
    const { user } = await openScene(STORM);

    await user.click(button("Delete"));
    expect(screen.getByRole("group", { name: "Delete “The Storm”?" })).toBeVisible();
    await user.click(button("Delete item"));

    await waitFor(() => expect(deleted).toEqual([STORM.id]));
    await screen.findByText("Choose an item in the outline to start writing.");
    expect(screen.queryByRole("textbox", { name: /Text of/ })).not.toBeInTheDocument();
    await waitFor(() => expect(linkTitles()).toEqual(["Act One", "The Calm", "Act Two"]));
    expect(screen.getByRole("heading", { level: 2, name: "Outline" })).toHaveFocus();
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("status")
          .some((status) => /“The Storm” was deleted\./.test(status.textContent)),
      ).toBe(true),
    );
  });

  it("saves text typed before the delete when the box is left, and sends nothing after the delete", async () => {
    plant([ACT, CALM, ACT_TWO]);
    const deleted = answerDelete();
    const saves = answerEverySave();
    const { user } = await openScene(STORM);
    await user.type(screen.getByRole("textbox", { name: "Text of “The Storm”" }), " Unsaved.");

    // Pressing Delete leaves the box, which saves the text: it is safe if the writer says Keep.
    await user.click(button("Delete"));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]?.body).toEqual({ content: "Waves crash. Unsaved." });

    await user.click(button("Delete item"));
    await waitFor(() => expect(deleted).toHaveLength(1));
    await screen.findByText("Choose an item in the outline to start writing.");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(saves).toHaveLength(1);
  });

  it("deletes an act together with its scenes, and says how many go", async () => {
    plant([ACT_TWO]);
    const deleted = answerDelete();
    const { user } = await openScene(ACT);

    await user.click(button("Delete"));
    expect(screen.getByRole("group", { name: "Delete “Act One”?" })).toHaveTextContent(
      "Its 2 scenes and all of their text are deleted too",
    );
    await user.click(button("Delete item"));

    await waitFor(() => expect(deleted).toEqual([ACT.id]));
    await waitFor(() => expect(linkTitles()).toEqual(["Act Two"]));
  });

  it("keeps everything when the question is answered with Keep", async () => {
    plant();
    const deleted = answerDelete();
    const { user } = await openScene(STORM);
    await user.click(button("Delete"));
    await user.click(button("Keep item"));
    expect(deleted).toEqual([]);
    expect(screen.getByRole("textbox", { name: "Text of “The Storm”" })).toBeVisible();
    expect(button("Delete")).toHaveFocus();
  });

  it("keeps the item and its text working when the delete fails", async () => {
    plant();
    server.use(
      http.delete("/projects/:projectId/documents/:id", () => problemResponse(503, "unavailable")),
    );
    const calls = answerEverySave();
    const { user } = await openScene(STORM);
    await user.click(button("Delete"));
    await user.click(button("Delete item"));
    expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent("The service is busy.");

    await user.click(button("Keep item"));
    const box = screen.getByRole("textbox", { name: "Text of “The Storm”" });
    await user.type(box, " Still here.");
    fireEvent.keyDown(box, { key: "s", ctrlKey: true });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toEqual({ content: "Waves crash. Still here." });
  });

  it("lets the writer open another item afterwards", async () => {
    plant([ACT, CALM, ACT_TWO]);
    answerDelete();
    const { user } = await openScene(STORM);
    await user.click(button("Delete"));
    await user.click(button("Delete item"));
    await screen.findByText("Choose an item in the outline to start writing.");

    await user.click(await within(outlineNav()).findByRole("link", { name: "The Calm" }));
    expect(await screen.findByRole("textbox", { name: "Text of “The Calm”" })).toHaveValue(
      "Still water.",
    );
  });
});

describe("WritingPage: accessibility of the toolbar", () => {
  it(
    "has no violations with the buttons, the rename form and the delete question",
    async () => {
      plant();
      const { user } = await openScene(STORM);
      await expectNoPageA11yViolations();

      await user.click(button("Rename"));
      await expectNoPageA11yViolations();
      await user.click(button("Cancel"));

      await user.click(button("Move to…"));
      await expectNoPageA11yViolations();
      await user.click(button("Cancel"));

      await user.click(button("Delete"));
      await expectNoPageA11yViolations();
    },
    HEAVY_TEST_TIMEOUT_MS,
  );
});
