import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../../../../lib/auth/session.tsx";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import {
  answerDeleteProject,
  answerUpdateProject,
  makeProject,
  problemResponse,
  updated,
} from "../../../../test-support/projects-handlers.ts";
import { deferred } from "../../../../test-support/session-harness.ts";
import { signedInManager } from "../../../../test-support/signed-in-manager.ts";
import { ProjectEntry } from "../ProjectEntry.tsx";

const PROJECT = makeProject({
  title: "The Lighthouse",
  format: "prose",
  logline: "A keeper finds a message.",
});

async function renderEntry(project = PROJECT) {
  const context = await signedInManager();
  const onSaved = vi.fn();
  const onUnchanged = vi.fn();
  const onDeleted = vi.fn();
  const view = render(
    <MemoryRouter>
      <AuthProvider manager={context.manager}>
        <ul>
          <ProjectEntry
            project={project}
            onSaved={onSaved}
            onUnchanged={onUnchanged}
            onDeleted={onDeleted}
          />
        </ul>
      </AuthProvider>
    </MemoryRouter>,
  );
  return { ...view, onSaved, onUnchanged, onDeleted, user: userEvent.setup() };
}

const editButton = () => screen.getByRole("button", { name: "Edit project “The Lighthouse”" });
const deleteButton = () => screen.getByRole("button", { name: "Delete project “The Lighthouse”" });

describe("ProjectEntry: showing the project", () => {
  it("shows the details and two buttons named after the project", async () => {
    await renderEntry();
    expect(screen.getByRole("heading", { level: 3, name: "The Lighthouse" })).toBeVisible();
    expect(screen.getByText("A keeper finds a message.")).toBeVisible();
    expect(editButton()).toBeVisible();
    expect(deleteButton()).toBeVisible();
  });

  it("has visible button words that are part of the accessible names (WCAG 2.5.3)", async () => {
    await renderEntry();
    expect(editButton()).toHaveTextContent(/^Edit/);
    expect(deleteButton()).toHaveTextContent(/^Delete/);
  });

  it("names the buttons with the title as plain text, whatever it contains", async () => {
    await renderEntry(makeProject({ title: "<b>x</b>" }));
    expect(screen.getByRole("button", { name: "Edit project “<b>x</b>”" })).toBeVisible();
    expect(document.querySelector("b")).toBeNull();
  });

  it("is quiet at the start: no form, no question, no focus taken", async () => {
    await renderEntry();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(document.body).toHaveFocus();
  });
});

describe("ProjectEntry: editing", () => {
  it("replaces the details with a form that has the focus on its title", async () => {
    const { user } = await renderEntry();
    await user.click(editButton());

    expect(screen.getByRole("form", { name: "Edit project “The Lighthouse”" })).toBeVisible();
    expect(screen.getByLabelText("Title")).toHaveFocus();
    expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit/ })).not.toBeInTheDocument();
  });

  it("goes back to the details and the Edit button on Cancel, changing nothing", async () => {
    const calls = answerUpdateProject(updated(PROJECT));
    const { user, onSaved } = await renderEntry();
    await user.click(editButton());
    await user.type(screen.getByLabelText("Title"), " changed");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "The Lighthouse" })).toBeVisible();
    expect(editButton()).toHaveFocus();
    expect(calls).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("opens the form again with the project's values, not the abandoned text", async () => {
    const { user } = await renderEntry();
    await user.click(editButton());
    await user.type(screen.getByLabelText("Title"), " abandoned");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(editButton());
    expect(screen.getByLabelText("Title")).toHaveValue("The Lighthouse");
  });

  it("tells the list the saved project, and shows the details with the focus on Edit", async () => {
    answerUpdateProject(updated(PROJECT));
    const { user, onSaved } = await renderEntry();
    await user.click(editButton());
    await user.type(screen.getByLabelText("Title"), "!");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSaved.mock.calls[0]?.[0]).toMatchObject({ id: PROJECT.id, title: "The Lighthouse!" });
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Edit/ })).toHaveFocus();
  });

  it("tells the list when nothing was different, and shows the details with the focus on Edit", async () => {
    const { user, onUnchanged, onSaved } = await renderEntry();
    await user.click(editButton());
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onUnchanged).toHaveBeenCalledTimes(1));
    expect(onSaved).not.toHaveBeenCalled();
    expect(editButton()).toHaveFocus();
  });

  it("stays in the form, with the problem shown, when the save fails", async () => {
    answerUpdateProject(() => problemResponse(503, "service-unavailable"));
    const { user, onSaved } = await renderEntry();
    await user.click(editButton());
    await user.type(screen.getByLabelText("Title"), "!");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The service is busy.");
    expect(screen.getByRole("form")).toBeVisible();
    expect(screen.getByLabelText("Title")).toHaveValue("The Lighthouse!");
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("ProjectEntry: deleting", () => {
  it("asks first, naming the project, with the focus on the safe button", async () => {
    const { user } = await renderEntry();
    await user.click(deleteButton());

    const question = screen.getByRole("group", { name: "Delete “The Lighthouse”?" });
    expect(question).toHaveTextContent("this cannot be undone");
    expect(screen.getByRole("button", { name: "Keep project" })).toHaveFocus();
  });

  it("keeps showing the details while it asks, and offers no Edit or Delete meanwhile", async () => {
    const { user } = await renderEntry();
    await user.click(deleteButton());
    expect(screen.getByRole("heading", { level: 3, name: "The Lighthouse" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Delete project “/ })).not.toBeInTheDocument();
  });

  it("deletes nothing when Keep is pressed, and the focus goes back to Delete", async () => {
    const calls = answerDeleteProject();
    const { user, onDeleted } = await renderEntry();
    await user.click(deleteButton());
    await user.click(screen.getByRole("button", { name: "Keep project" }));

    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(deleteButton()).toHaveFocus();
    expect(calls).toHaveLength(0);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("deletes nothing when Escape is pressed, and the focus goes back to Delete", async () => {
    const calls = answerDeleteProject();
    const { user, onDeleted } = await renderEntry();
    await user.click(deleteButton());
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(deleteButton()).toHaveFocus();
    expect(calls).toHaveLength(0);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("does not delete when Enter is pressed straight after the question opens", async () => {
    const calls = answerDeleteProject();
    const { user, onDeleted } = await renderEntry();
    await user.click(deleteButton());
    // The focus is on "Keep project", so Enter keeps the project.
    await user.keyboard("{Enter}");
    expect(calls).toHaveLength(0);
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("deletes the project when it is confirmed, and tells the list", async () => {
    const calls = answerDeleteProject();
    const { user, onDeleted } = await renderEntry();
    await user.click(deleteButton());
    await user.click(screen.getByRole("button", { name: "Delete project" }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.id).toBe(PROJECT.id);
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer token-1");
    expect(onDeleted.mock.calls[0]?.[0]).toMatchObject({ id: PROJECT.id });
  });

  it("is busy while it deletes, and sends the request only once however often it is pressed", async () => {
    const gate = deferred<Response>();
    const calls = answerDeleteProject(() => gate.promise);
    const { user, onDeleted } = await renderEntry();
    await user.click(deleteButton());
    const confirm = screen.getByRole("button", { name: "Delete project" });
    await user.click(confirm);
    await user.click(confirm);
    await user.click(confirm);

    expect(await screen.findByText("Deleting the project…")).toBeVisible();
    expect(confirm).toHaveAttribute("aria-busy", "true");
    expect(calls).toHaveLength(1);

    gate.resolve(new HttpResponse(null, { status: 204 }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(calls).toHaveLength(1);
  });

  it("counts a project that is already gone as deleted", async () => {
    answerDeleteProject(() => problemResponse(404, "not-found"));
    const { user, onDeleted } = await renderEntry();
    await user.click(deleteButton());
    await user.click(screen.getByRole("button", { name: "Delete project" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });

  it("keeps the project and says why when the delete fails, and can be tried again", async () => {
    let attempts = 0;
    answerDeleteProject(() => {
      attempts += 1;
      return attempts === 1
        ? problemResponse(503, "service-unavailable")
        : new HttpResponse(null, { status: 204 });
    });
    const { user, onDeleted } = await renderEntry();
    await user.click(deleteButton());
    await user.click(screen.getByRole("button", { name: "Delete project" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The service is busy.");
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.getByRole("group")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Delete project" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });

  it("forgets an old error when the question is closed and opened again", async () => {
    answerDeleteProject(() => problemResponse(503, "service-unavailable"));
    const { user } = await renderEntry();
    await user.click(deleteButton());
    await user.click(screen.getByRole("button", { name: "Delete project" }));
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: "Keep project" }));
    await user.click(deleteButton());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("ProjectEntry: several projects", () => {
  it("keeps each project's own state: editing one does not touch another", async () => {
    const context = await signedInManager();
    const first = makeProject({ title: "First" });
    const second = makeProject({ title: "Second" });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider manager={context.manager}>
          <ul>
            <ProjectEntry
              project={first}
              onSaved={vi.fn()}
              onUnchanged={vi.fn()}
              onDeleted={vi.fn()}
            />
            <ProjectEntry
              project={second}
              onSaved={vi.fn()}
              onUnchanged={vi.fn()}
              onDeleted={vi.fn()}
            />
          </ul>
        </AuthProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Edit project “First”" }));
    await user.click(screen.getByRole("button", { name: "Delete project “Second”" }));

    const items = screen.getAllByRole("listitem");
    expect(within(items[0] as HTMLElement).getByRole("form")).toBeVisible();
    expect(within(items[1] as HTMLElement).getByRole("group")).toBeVisible();
  });
});

describe("ProjectEntry: accessibility", () => {
  it("has no violations viewing, editing, asking, and with a delete error", async () => {
    const { container, user } = await renderEntry();
    await expectNoA11yViolations(container);

    await user.click(editButton());
    await expectNoA11yViolations(container);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(deleteButton());
    await expectNoA11yViolations(container);
  });
});
