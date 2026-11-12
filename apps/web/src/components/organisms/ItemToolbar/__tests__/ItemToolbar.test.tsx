import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../../../../lib/auth/session.tsx";
import {
  createDocumentSaver,
  type DocumentSaver,
} from "../../../../lib/documents/document-saver.ts";
import { buildTree, type OutlineNode } from "../../../../lib/documents/use-outline.ts";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import {
  answerSave,
  makeDocument,
  makeOutlineItem,
  saved,
} from "../../../../test-support/documents-handlers.ts";
import { server } from "../../../../test-support/msw-server.ts";
import { problemResponse } from "../../../../test-support/projects-handlers.ts";
import { deferred } from "../../../../test-support/session-harness.ts";
import { signedInManager } from "../../../../test-support/signed-in-manager.ts";
import { ItemToolbar } from "../ItemToolbar.tsx";

// Act 1 holds scenes 1a, 1b, 1c; Act 2 holds 2a; Chapter 3 is empty.
const act1 = makeOutlineItem({ title: "Act 1", position: 0 });
const s1a = makeOutlineItem({ title: "Scene 1a", parentId: act1.id, position: 0 });
const s1b = makeOutlineItem({ title: "Scene 1b", parentId: act1.id, position: 1 });
const s1c = makeOutlineItem({ title: "Scene 1c", parentId: act1.id, position: 2 });
const act2 = makeOutlineItem({ title: "Act 2", position: 1 });
const s2a = makeOutlineItem({ title: "Scene 2a", parentId: act2.id, position: 0 });
const ch3 = makeOutlineItem({ title: "Chapter 3", position: 2 });
const nodes: readonly OutlineNode[] = buildTree([act1, s1a, s1b, s1c, act2, s2a, ch3]);

function realSaver(version = 3): DocumentSaver {
  return createDocumentSaver(
    { text: "text", version, wordCount: 1 },
    {
      save: vi.fn().mockResolvedValue({ version: version + 1, wordCount: 1 }),
      load: vi.fn().mockResolvedValue({ version }),
      setTimer: (callback, ms) => {
        const id = setTimeout(callback, ms);
        return () => {
          clearTimeout(id);
        };
      },
      reportError: vi.fn(),
    },
  );
}

async function renderToolbar(itemId: string, tree: readonly OutlineNode[] = nodes) {
  const context = await signedInManager();
  const item = [...tree, ...tree.flatMap((node) => node.children)].find(
    (node) => node.id === itemId,
  );
  if (item === undefined) throw new Error("The item is not in the test outline.");
  const saver = realSaver();
  const refresh = vi.fn(() => Promise.resolve(tree));
  const onDeleted = vi.fn();
  const announce = vi.fn();
  const view = render(
    <AuthProvider manager={context.manager}>
      <ItemToolbar
        projectId="project-1"
        item={{ id: item.id, title: item.title }}
        nodes={tree}
        saver={saver}
        refresh={refresh}
        onDeleted={onDeleted}
        announce={announce}
      />
    </AuthProvider>,
  );
  return { ...view, saver, refresh, onDeleted, announce, user: userEvent.setup() };
}

const documentAt = (id: string) => makeDocument({ id, version: 3, projectId: "project-1" });
const button = (name: string) => screen.getByRole("button", { name });

function answerDelete(reply: () => Response | Promise<Response>) {
  const calls: string[] = [];
  server.use(
    http.delete("/projects/:projectId/documents/:id", ({ request }) => {
      calls.push(new URL(request.url).pathname);
      return reply();
    }),
  );
  return calls;
}

describe("ItemToolbar: the buttons", () => {
  it("is a group named after the item, with all five actions for a scene that can go elsewhere", async () => {
    await renderToolbar(s1b.id);
    const group = screen.getByRole("group", { name: "Actions for “Scene 1b”" });
    expect(
      within(group)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Rename", "Move up", "Move down", "Move to…", "Delete"]);
  });

  it("names the item as text, whatever its title contains", async () => {
    const odd = makeOutlineItem({ title: "<b>Odd</b> “quoted”" });
    await renderToolbar(odd.id, buildTree([odd]));
    expect(screen.getByRole("group", { name: "Actions for “<b>Odd</b> “quoted””" })).toBeVisible();
    expect(document.querySelector("b")).toBeNull();
  });

  it("marks Move up as unavailable for the first item, and keeps it focusable", async () => {
    const { user, refresh } = await renderToolbar(s1a.id);
    const up = button("Move up");
    expect(up).toHaveAttribute("aria-disabled", "true");
    expect(button("Move down")).not.toHaveAttribute("aria-disabled");

    await user.click(up);
    up.focus();
    expect(up).toHaveFocus();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("marks Move down as unavailable for the last item", async () => {
    await renderToolbar(s1c.id);
    expect(button("Move down")).toHaveAttribute("aria-disabled", "true");
    expect(button("Move up")).not.toHaveAttribute("aria-disabled");
  });

  it("marks both as unavailable for an only child", async () => {
    await renderToolbar(s2a.id);
    expect(button("Move up")).toHaveAttribute("aria-disabled", "true");
    expect(button("Move down")).toHaveAttribute("aria-disabled", "true");
  });

  it("sends nothing when a press lands on an unavailable button", async () => {
    const calls = answerSave(saved(documentAt(s1a.id)));
    const { user } = await renderToolbar(s1a.id);
    await user.click(button("Move up"));
    expect(calls).toEqual([]);
  });

  it("offers no Move to… for an act that has scenes: the outline has one level", async () => {
    await renderToolbar(act1.id);
    expect(screen.queryByRole("button", { name: "Move to…" })).not.toBeInTheDocument();
    expect(button("Move up")).toHaveAttribute("aria-disabled", "true");
    expect(button("Move down")).not.toHaveAttribute("aria-disabled");
  });

  it("offers Move to… for a chapter without scenes", async () => {
    await renderToolbar(ch3.id);
    expect(button("Move to…")).toBeVisible();
  });
});

describe("ItemToolbar: moving up and down", () => {
  it("moves up with the version it holds, reads the outline again and says so", async () => {
    const calls = answerSave(saved(documentAt(s1b.id)));
    const { user, refresh, announce } = await renderToolbar(s1b.id);

    await user.click(button("Move up"));

    await waitFor(() => expect(announce).toHaveBeenCalled());
    expect(calls).toHaveLength(1);
    expect(calls[0]?.id).toBe(s1b.id);
    expect(calls[0]?.ifMatch).toBe('"3"');
    expect(calls[0]?.body).toEqual({ position: 0 });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("moves down by one place", async () => {
    const calls = answerSave(saved(documentAt(s1b.id)));
    const { user, announce } = await renderToolbar(s1b.id);
    await user.click(button("Move down"));
    await waitFor(() => expect(announce).toHaveBeenCalled());
    expect(calls[0]?.body).toEqual({ position: 2 });
  });

  it("keeps the focus on the button that was pressed", async () => {
    answerSave(saved(documentAt(s1b.id)));
    const { user, announce } = await renderToolbar(s1b.id);
    await user.click(button("Move up"));
    await waitFor(() => expect(announce).toHaveBeenCalled());
    expect(button("Move up")).toHaveFocus();
  });

  it("works with the keyboard alone", async () => {
    const calls = answerSave(saved(documentAt(s1b.id)));
    const { user, announce } = await renderToolbar(s1b.id);
    button("Move down").focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(announce).toHaveBeenCalled());
    expect(calls[0]?.body).toEqual({ position: 2 });
  });

  it("says why it failed, as an alert, without taking the focus from the button", async () => {
    answerSave(() => problemResponse(503, "unavailable"));
    const { user, announce } = await renderToolbar(s1b.id);

    await user.click(button("Move up"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The service is busy. Try again in a moment.",
    );
    expect(button("Move up")).toHaveFocus();
    expect(announce).not.toHaveBeenCalled();
  });

  it("shows the buttons as busy while a move runs, and ignores a second press", async () => {
    const gate = deferred<Response>();
    const calls = answerSave(() => gate.promise);
    const { user } = await renderToolbar(s1b.id);

    await user.click(button("Move up"));
    await waitFor(() => expect(button("Move up")).toHaveAttribute("aria-busy", "true"));
    expect(screen.getByRole("status")).toHaveTextContent("Working…");
    await user.click(button("Move up"));
    await user.click(button("Move down"));
    expect(calls).toHaveLength(1);

    gate.resolve(HttpResponse.json({ ...documentAt(s1b.id), version: 4 }));
    await waitFor(() => expect(button("Move up")).not.toHaveAttribute("aria-busy"));
    expect(calls).toHaveLength(1);
  });

  it("tells the writer to settle the newer text first after a 412", async () => {
    answerSave(() => problemResponse(412, "precondition-failed"));
    const { user, saver } = await renderToolbar(s1b.id);
    await user.click(button("Move up"));
    expect(await screen.findByRole("alert")).toHaveTextContent("nothing was moved");
    expect(saver.getSnapshot().status.kind).toBe("conflict");
  });

  it("forgets an old problem when the next action starts", async () => {
    answerSave(() => problemResponse(503, "unavailable"));
    const { user } = await renderToolbar(s1b.id);
    await user.click(button("Move up"));
    await screen.findByRole("alert");

    answerSave(saved(documentAt(s1b.id)));
    await user.click(button("Move down"));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});

describe("ItemToolbar: renaming", () => {
  it("opens a form with the title selected and the focus in it, in place of the buttons", async () => {
    const { user } = await renderToolbar(s1b.id);
    await user.click(button("Rename"));

    const field = screen.getByRole("textbox", { name: "New title" });
    expect(field).toHaveFocus();
    expect(field).toHaveValue("Scene 1b");
    expect(screen.queryByRole("button", { name: "Move up" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Actions for “Scene 1b”" })).toBeVisible();
  });

  it("sends the new title, then shows the buttons again with the focus on Rename", async () => {
    const calls = answerSave(saved(documentAt(s1b.id)));
    const { user, refresh, announce } = await renderToolbar(s1b.id);
    await user.click(button("Rename"));
    await user.keyboard("A better name{Enter}");

    await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
    expect(calls[0]?.body).toEqual({ title: "A better name" });
    expect(calls[0]?.ifMatch).toBe('"3"');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("Renamed to “A better name”.");
    expect(button("Rename")).toHaveFocus();
  });

  it("closes without a request when Cancel or Escape is pressed, and gives the focus back", async () => {
    const calls = answerSave(saved(documentAt(s1b.id)));
    const { user } = await renderToolbar(s1b.id);

    await user.click(button("Rename"));
    await user.click(button("Cancel"));
    expect(button("Rename")).toHaveFocus();

    await user.click(button("Rename"));
    await user.keyboard("{Escape}");
    expect(button("Rename")).toHaveFocus();
    expect(calls).toEqual([]);
  });

  it("closes without a request when the title was not changed", async () => {
    const calls = answerSave(saved(documentAt(s1b.id)));
    const { user, refresh } = await renderToolbar(s1b.id);
    await user.click(button("Rename"));
    await user.click(button("Save title"));
    await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
    expect(calls).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
    expect(button("Rename")).toHaveFocus();
  });

  it("asks for a title when it is empty, keeps the form open and sends nothing", async () => {
    const calls = answerSave(saved(documentAt(s1b.id)));
    const { user } = await renderToolbar(s1b.id);
    await user.click(button("Rename"));
    await user.clear(screen.getByRole("textbox", { name: "New title" }));
    await user.click(button("Save title"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a title.");
    expect(screen.getByRole("textbox", { name: "New title" })).toBeVisible();
    expect(calls).toEqual([]);
  });

  it("keeps the form and what was typed when the API refuses the title", async () => {
    answerSave(() =>
      problemResponse(400, "validation", {
        errors: [{ pointer: "/title", message: "The title can be at most 200 characters." }],
      }),
    );
    const { user, announce } = await renderToolbar(s1b.id);
    await user.click(button("Rename"));
    await user.keyboard("Too long{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The title can be at most 200 characters.",
    );
    expect(screen.getByRole("textbox", { name: "New title" })).toHaveValue("Too long");
    expect(announce).not.toHaveBeenCalled();
  });

  it("says that the server cannot be reached, and keeps the form", async () => {
    server.use(http.patch("*", () => HttpResponse.error()));
    const { user } = await renderToolbar(s1b.id);
    await user.click(button("Rename"));
    await user.keyboard("New{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");
    expect(screen.getByRole("textbox", { name: "New title" })).toHaveValue("New");
  });

  it("forgets the problem when the form is closed and opened again", async () => {
    answerSave(() => problemResponse(503, "unavailable"));
    const { user } = await renderToolbar(s1b.id);
    await user.click(button("Rename"));
    await user.keyboard("New{Enter}");
    await screen.findByRole("alert");

    await user.click(button("Cancel"));
    await user.click(button("Rename"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("ItemToolbar: moving to another place", () => {
  it("opens the list of places with the focus on it, naming only valid places", async () => {
    const { user } = await renderToolbar(s1b.id);
    await user.click(button("Move to…"));

    const list = screen.getByRole("combobox", { name: "Move to" });
    expect(list).toHaveFocus();
    expect(
      within(list)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Top level", "Inside “Act 2”", "Inside “Chapter 3”"]);
  });

  it("moves into the chosen act, then shows the buttons with the focus on Move to…", async () => {
    const calls = answerSave(saved(documentAt(s1b.id)));
    const { user, refresh, announce } = await renderToolbar(s1b.id);
    await user.click(button("Move to…"));
    await user.selectOptions(screen.getByRole("combobox", { name: "Move to" }), act2.id);
    await user.click(button("Move"));

    await waitFor(() => expect(screen.queryByRole("combobox")).not.toBeInTheDocument());
    expect(calls[0]?.body).toEqual({ parentId: act2.id });
    expect(calls[0]?.ifMatch).toBe('"3"');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalled();
    expect(button("Move to…")).toHaveFocus();
  });

  it("moves to the top level with null", async () => {
    const calls = answerSave(saved(documentAt(s1b.id)));
    const { user } = await renderToolbar(s1b.id);
    await user.click(button("Move to…"));
    await user.click(button("Move"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toEqual({ parentId: null });
  });

  it("closes without a request when Cancel or Escape is pressed", async () => {
    const calls = answerSave(saved(documentAt(s1b.id)));
    const { user } = await renderToolbar(s1b.id);
    await user.click(button("Move to…"));
    await user.click(button("Cancel"));
    expect(button("Move to…")).toHaveFocus();
    await user.click(button("Move to…"));
    await user.keyboard("{Escape}");
    expect(button("Move to…")).toHaveFocus();
    expect(calls).toEqual([]);
  });

  it("keeps the form open with the reason when the move is refused", async () => {
    answerSave(() => problemResponse(400, "validation"));
    const { user } = await renderToolbar(s1b.id);
    await user.click(button("Move to…"));
    await user.click(button("Move"));
    expect(await screen.findByRole("alert")).toHaveTextContent("That is not possible here.");
    expect(screen.getByRole("combobox", { name: "Move to" })).toBeVisible();
  });
});

describe("ItemToolbar: deleting", () => {
  it("asks first, naming the item and what else goes, with the focus on the safe answer", async () => {
    const { user } = await renderToolbar(s1b.id);
    await user.click(button("Delete"));

    const question = screen.getByRole("group", { name: "Delete “Scene 1b”?" });
    expect(question).toHaveTextContent("Its text is deleted too, and this cannot be undone.");
    expect(button("Keep item")).toHaveFocus();
  });

  it("counts the scenes that go with an act", async () => {
    const { user } = await renderToolbar(act1.id);
    await user.click(button("Delete"));
    expect(screen.getByRole("group", { name: "Delete “Act 1”?" })).toHaveTextContent(
      "Its 3 scenes and all of their text are deleted too, and this cannot be undone.",
    );
  });

  it("says scene, not scenes, for one", async () => {
    const { user } = await renderToolbar(act2.id);
    await user.click(button("Delete"));
    expect(screen.getByRole("group", { name: "Delete “Act 2”?" })).toHaveTextContent(
      "Its 1 scene and all of their text",
    );
  });

  it("keeps the item and gives the focus back to Delete when Keep is pressed, or Escape", async () => {
    const calls = answerDelete(() => new HttpResponse(null, { status: 204 }));
    const { user, onDeleted } = await renderToolbar(s1b.id);

    await user.click(button("Delete"));
    await user.click(button("Keep item"));
    expect(button("Delete")).toHaveFocus();

    await user.click(button("Delete"));
    await user.keyboard("{Escape}");
    expect(button("Delete")).toHaveFocus();
    expect(calls).toEqual([]);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("deletes after the question, tells the screen, and says so", async () => {
    const calls = answerDelete(() => new HttpResponse(null, { status: 204 }));
    const { user, onDeleted, announce, refresh } = await renderToolbar(s1b.id);
    await user.click(button("Delete"));
    await user.click(button("Delete item"));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([`/projects/project-1/documents/${s1b.id}`]);
    expect(announce).toHaveBeenCalledWith("“Scene 1b” was deleted.");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the question open with the reason when the delete fails", async () => {
    answerDelete(() => problemResponse(503, "unavailable"));
    const { user, onDeleted } = await renderToolbar(s1b.id);
    await user.click(button("Delete"));
    await user.click(button("Delete item"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The service is busy. Try again in a moment.",
    );
    expect(button("Delete item")).toBeVisible();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("shows the question as busy while the delete runs, and Escape does not cancel it", async () => {
    const gate = deferred<Response>();
    answerDelete(() => gate.promise);
    const { user, onDeleted } = await renderToolbar(s1b.id);
    await user.click(button("Delete"));
    await user.click(button("Delete item"));

    await waitFor(() => expect(button("Delete item")).toHaveAttribute("aria-busy", "true"));
    await user.keyboard("{Escape}");
    expect(button("Delete item")).toBeVisible();

    gate.resolve(new HttpResponse(null, { status: 204 }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });

  it("forgets an old problem when the question is closed and opened again", async () => {
    answerDelete(() => problemResponse(503, "unavailable"));
    const { user } = await renderToolbar(s1b.id);
    await user.click(button("Delete"));
    await user.click(button("Delete item"));
    await screen.findByRole("alert");
    await user.click(button("Keep item"));
    await user.click(button("Delete"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("ItemToolbar: accessibility", () => {
  it("has no violations in the buttons, with a problem, and in each of the three forms", async () => {
    answerSave(() => problemResponse(503, "unavailable"));
    const { user, container } = await renderToolbar(s1b.id);
    await expectNoA11yViolations(container);

    await user.click(button("Move up"));
    await screen.findByRole("alert");
    await expectNoA11yViolations(container);

    await user.click(button("Rename"));
    await expectNoA11yViolations(container);
    await user.click(button("Cancel"));

    await user.click(button("Move to…"));
    await expectNoA11yViolations(container);
    await user.click(button("Cancel"));

    await user.click(button("Delete"));
    await expectNoA11yViolations(container);
  });
});
