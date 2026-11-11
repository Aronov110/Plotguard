import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../../../../lib/auth/session.tsx";
import type { ProjectsView } from "../../../../lib/projects/use-projects.ts";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import { answerDeleteProject, makeProject } from "../../../../test-support/projects-handlers.ts";
import { projectItemId } from "../../../molecules/ProjectListItem/ProjectListItem.tsx";
import { ProjectList } from "../ProjectList.tsx";

function readyView(
  overrides: Partial<Extract<ProjectsView, { status: "ready" }>> = {},
): ProjectsView {
  return {
    status: "ready",
    items: [],
    hasMore: false,
    loadingMore: false,
    moreError: undefined,
    justLoaded: undefined,
    announcement: undefined,
    ...overrides,
  };
}

const HEADING_ID = "list-heading";

function renderList(view: ProjectsView) {
  const onRetry = vi.fn();
  const onLoadMore = vi.fn();
  const onSaved = vi.fn();
  const onUnchanged = vi.fn();
  const onDeleted = vi.fn();
  const element = (next: ProjectsView) => (
    <AuthProvider>
      <h2 id={HEADING_ID} tabIndex={-1}>
        All your projects
      </h2>
      <ProjectList
        view={next}
        onRetry={onRetry}
        onLoadMore={onLoadMore}
        headingId={HEADING_ID}
        onSaved={onSaved}
        onUnchanged={onUnchanged}
        onDeleted={onDeleted}
      />
    </AuthProvider>
  );
  const result = render(element(view));
  return {
    ...result,
    onRetry,
    onLoadMore,
    onSaved,
    onUnchanged,
    onDeleted,
    user: userEvent.setup(),
    show: (next: ProjectsView) => {
      result.rerender(element(next));
    },
  };
}

describe("ProjectList: loading", () => {
  it("says that the projects are loading, politely", () => {
    renderList({ status: "loading" });
    expect(screen.getByRole("status")).toHaveTextContent("Loading your projects…");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("ProjectList: failed", () => {
  it("shows the problem as an alert and a button to try again", async () => {
    const { user, onRetry } = renderList({
      status: "failed",
      message: "Can't reach the server. Check your connection and try again.",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Can't reach the server. Check your connection and try again.",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows the message as plain text", () => {
    renderList({ status: "failed", message: "<b>x</b>" });
    expect(screen.getByRole("alert")).toHaveTextContent("<b>x</b>");
    expect(document.querySelector("b")).toBeNull();
  });
});

describe("ProjectList: empty", () => {
  it("tells a person without projects where to start", () => {
    renderList(readyView());
    expect(
      screen.getByText("You have no projects yet. Use the form above to start your first one."),
    ).toBeVisible();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("ProjectList: with projects", () => {
  it("is a list with one item per project, in the order given", () => {
    const items = ["A", "B", "C"].map((title) => makeProject({ title }));
    renderList(readyView({ items }));
    const list = screen.getByRole("list");
    const shown = within(list).getAllByRole("listitem");
    expect(shown).toHaveLength(3);
    expect(shown.map((item) => within(item).getByRole("heading").textContent)).toEqual([
      "A",
      "B",
      "C",
    ]);
  });

  it("has no 'Load more' button on the last page", () => {
    renderList(readyView({ items: [makeProject()], hasMore: false }));
    expect(screen.queryByRole("button", { name: "Load more projects" })).not.toBeInTheDocument();
  });

  it("has a 'Load more' button when there is a next page, and presses call for it", async () => {
    const { user, onLoadMore } = renderList(readyView({ items: [makeProject()], hasMore: true }));
    await user.click(screen.getByRole("button", { name: "Load more projects" }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("shows that more is loading, and does not call again while it is", async () => {
    const { user, onLoadMore } = renderList(
      readyView({ items: [makeProject()], hasMore: true, loadingMore: true }),
    );
    const button = screen.getByRole("button", { name: "Load more projects" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Loading more projects…");
    await user.click(button);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("shows why a page failed, next to the button, and keeps the projects", () => {
    renderList(
      readyView({
        items: [makeProject({ title: "Kept" })],
        hasMore: true,
        moreError: "The service is busy. Try again in a moment.",
      }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("The service is busy.");
    expect(screen.getByRole("heading", { name: "Kept" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Load more projects" })).toBeVisible();
  });
});

describe("ProjectList: after a page was added", () => {
  const first = makeProject({ title: "First new" });
  const old = makeProject({ title: "Old" });

  it("announces how many were added, and says one project in the singular", () => {
    const { show } = renderList(readyView({ items: [old], hasMore: true }));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    show(
      readyView({
        items: [old, first],
        hasMore: true,
        justLoaded: { firstId: first.id, count: 1, serial: 1 },
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("1 more project loaded.");
  });

  it("says projects in the plural", () => {
    renderList(
      readyView({
        items: [old, first],
        justLoaded: { firstId: first.id, count: 20, serial: 1 },
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("20 more projects loaded.");
  });

  it("moves the focus to the first new project", () => {
    const { show } = renderList(readyView({ items: [old], hasMore: true }));
    expect(document.body).toHaveFocus();

    show(
      readyView({
        items: [old, first],
        hasMore: true,
        justLoaded: { firstId: first.id, count: 1, serial: 1 },
      }),
    );
    expect(document.getElementById(projectItemId(first.id))).toHaveFocus();
  });

  it("keeps the focus on the list when the button disappears on the last page", () => {
    const { show } = renderList(readyView({ items: [old], hasMore: true }));
    show(
      readyView({
        items: [old, first],
        hasMore: false,
        justLoaded: { firstId: first.id, count: 1, serial: 1 },
      }),
    );
    expect(screen.queryByRole("button", { name: "Load more projects" })).not.toBeInTheDocument();
    expect(document.getElementById(projectItemId(first.id))).toHaveFocus();
  });

  it("moves the focus again for the next page, even one of the same size", () => {
    const second = makeProject({ title: "Second new" });
    const { show } = renderList(readyView({ items: [old], hasMore: true }));
    show(
      readyView({
        items: [old, first],
        hasMore: true,
        justLoaded: { firstId: first.id, count: 1, serial: 1 },
      }),
    );
    (document.activeElement as HTMLElement).blur();
    show(
      readyView({
        items: [old, first, second],
        hasMore: true,
        justLoaded: { firstId: second.id, count: 1, serial: 2 },
      }),
    );
    expect(document.getElementById(projectItemId(second.id))).toHaveFocus();
  });

  it("does not take the focus when nothing was added", () => {
    renderList(readyView({ items: [old, first] }));
    expect(document.body).toHaveFocus();
  });

  it("does not fail when the project to focus is not there", () => {
    renderList(
      readyView({ items: [old], justLoaded: { firstId: "missing", count: 1, serial: 1 } }),
    );
    expect(document.body).toHaveFocus();
  });
});

describe("ProjectList: accessibility", () => {
  it.each([
    ["loading", { status: "loading" } as ProjectsView],
    ["failed", { status: "failed", message: "Something went wrong." } as ProjectsView],
    ["empty", readyView()],
    [
      "with projects and a button",
      readyView({
        items: [makeProject({ logline: "A logline." }), makeProject()],
        hasMore: true,
        moreError: "A problem.",
      }),
    ],
  ])("has no violations when %s", async (_name, view) => {
    const { container } = renderList(view);
    await expectNoA11yViolations(container);
  });
});

describe("ProjectList: changing and deleting", () => {
  const [a, b, c] = [
    makeProject({ title: "Alpha" }),
    makeProject({ title: "Beta" }),
    makeProject({ title: "Gamma" }),
  ];

  it("gives every project an Edit and a Delete button, named after the project", () => {
    renderList(readyView({ items: [a, b] }));
    expect(screen.getByRole("button", { name: "Edit project “Alpha”" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Delete project “Alpha”" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit project “Beta”" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Delete project “Beta”" })).toBeVisible();
  });

  it("tells the page which project was saved, and when nothing was different", async () => {
    const { user, onSaved, onUnchanged } = renderList(readyView({ items: [a] }));
    await user.click(screen.getByRole("button", { name: "Edit project “Alpha”" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onUnchanged).toHaveBeenCalledTimes(1));
    expect(onSaved).not.toHaveBeenCalled();
  });

  describe("after a delete", () => {
    async function deleteOne(
      user: ReturnType<typeof userEvent.setup>,
      title: string,
      onDeleted: ReturnType<typeof vi.fn>,
    ) {
      await user.click(screen.getByRole("button", { name: `Delete project “${title}”` }));
      await user.click(screen.getByRole("button", { name: "Delete project" }));
      await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    }

    it("tells the page which project is gone", async () => {
      answerDeleteProject();
      const { user, onDeleted } = renderList(readyView({ items: [a, b, c] }));
      await deleteOne(user, "Beta", onDeleted);
      expect(onDeleted.mock.calls[0]?.[0]).toMatchObject({ id: b.id, title: "Beta" });
    });

    it("moves the focus to the next project", async () => {
      answerDeleteProject();
      const { user, onDeleted, show } = renderList(readyView({ items: [a, b, c] }));
      await deleteOne(user, "Beta", onDeleted);

      show(readyView({ items: [a, c] }));
      expect(document.getElementById(projectItemId(c.id))).toHaveFocus();
    });

    it("moves the focus to the previous project when the last one was deleted", async () => {
      answerDeleteProject();
      const { user, onDeleted, show } = renderList(readyView({ items: [a, b, c] }));
      await deleteOne(user, "Gamma", onDeleted);

      show(readyView({ items: [a, b] }));
      expect(document.getElementById(projectItemId(b.id))).toHaveFocus();
    });

    it("moves the focus to the heading when the only project was deleted", async () => {
      answerDeleteProject();
      const { user, onDeleted, show } = renderList(readyView({ items: [a] }));
      await deleteOne(user, "Alpha", onDeleted);

      show(readyView({ items: [] }));
      expect(document.getElementById(HEADING_ID)).toHaveFocus();
      expect(screen.getByText(/You have no projects yet/)).toBeVisible();
    });

    it("does not move the focus when nothing was deleted", () => {
      const { show } = renderList(readyView({ items: [a, b] }));
      show(readyView({ items: [b, a] }));
      expect(document.body).toHaveFocus();
    });
  });

  describe("what is announced after a change", () => {
    it("says what happened, politely", () => {
      renderList(
        readyView({ items: [a], announcement: { text: "Project “Alpha” saved.", serial: 1 } }),
      );
      expect(screen.getByRole("status")).toHaveTextContent("Project “Alpha” saved.");
    });

    it("changes the text when the same words come twice in a row, so they are said again", () => {
      const { show } = renderList(
        readyView({ items: [a], announcement: { text: "No changes to save.", serial: 1 } }),
      );
      const first = screen.getByRole("status").textContent;
      show(readyView({ items: [a], announcement: { text: "No changes to save.", serial: 2 } }));
      const second = screen.getByRole("status").textContent;
      expect(second).not.toBe(first);
      expect(second?.trim()).toBe(first?.trim());
    });

    it("says an announcement instead of the count of a page that was loaded earlier", () => {
      renderList(
        readyView({
          items: [a, b],
          justLoaded: { firstId: b.id, count: 1, serial: 1 },
          announcement: { text: "Project “Alpha” deleted.", serial: 2 },
        }),
      );
      expect(screen.getByRole("status")).toHaveTextContent("Project “Alpha” deleted.");
    });

    it("says nothing when there is nothing to say", () => {
      renderList(readyView({ items: [a] }));
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
    });
  });
});
