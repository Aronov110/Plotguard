import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoPageA11yViolations } from "../../../../test-support/a11y.ts";
import {
  answerCreateProject,
  answerDeleteProject,
  answerProjectList,
  answerUpdateProject,
  created,
  makeProject,
  problemResponse,
  projectPage,
  updated,
} from "../../../../test-support/projects-handlers.ts";
import { renderApp } from "../../../../test-support/render-app.tsx";
import { projectItemId } from "../../../molecules/ProjectListItem/ProjectListItem.tsx";

const HEADING = { level: 1, name: "Your projects" } as const;

async function openHome(options: Parameters<typeof renderApp>[0] = {}) {
  const view = renderApp({ route: "/app", signedIn: true, ...options });
  await screen.findByRole("heading", HEADING);
  return view;
}

// Project titles are the only level-three headings. (The page can hold other lists, such as the
// one inside a problem box, so the list of projects is not looked up by its role.)
const titlesShown = () =>
  screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);

/**
 * The open form of one project. The page also holds the new-project form, which has a "Title" of
 * its own, so the fields of an edit form are looked up inside it.
 */
const editForm = (title: string) =>
  within(screen.getByRole("form", { name: `Edit project “${title}”` }));

describe("AppHomePage: the frame", () => {
  it("is titled Your projects, in the page and in the tab", async () => {
    answerProjectList(projectPage([]));
    await openHome();
    expect(screen.getByRole("heading", HEADING)).toBeInTheDocument();
    expect(document.title).toBe("Your projects – Plotpal");
  });

  it("has a section to start a project and a section with all projects, each with a heading", async () => {
    answerProjectList(projectPage([]));
    await openHome();
    expect(screen.getByRole("heading", { level: 2, name: "Start a new project" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "All your projects" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Start a new project" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "All your projects" })).toBeInTheDocument();
  });

  it("shows who is signed in, by display name when there is one", async () => {
    answerProjectList(projectPage([]));
    await openHome({ signedIn: { displayName: "Ada" } });
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Signed in as")).toBeInTheDocument();
  });

  it("shows who is signed in, by email when there is no display name", async () => {
    answerProjectList(projectPage([]));
    await openHome();
    expect(await screen.findByText("ada@example.com")).toBeInTheDocument();
  });

  it("has a sign-out button", async () => {
    answerProjectList(projectPage([]));
    await openHome();
    expect(await screen.findByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("is not shown to someone who is signed out, and asks the API for nothing", async () => {
    const calls = answerProjectList(projectPage([makeProject({ title: "Private" })]));
    renderApp({ route: "/app" });
    expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
    expect(screen.queryByText("Private")).not.toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});

describe("AppHomePage: the list", () => {
  it("says that the projects are loading, then shows them", async () => {
    answerProjectList(
      projectPage([
        makeProject({ title: "Lighthouse", format: "prose", logline: "A keeper finds a message." }),
        makeProject({ title: "Night Shift" }),
      ]),
    );
    renderApp({ route: "/app", signedIn: true });

    expect(await screen.findByText("Loading your projects…")).toBeVisible();
    expect(await screen.findByRole("heading", { level: 3, name: "Lighthouse" })).toBeVisible();
    expect(screen.queryByText("Loading your projects…")).not.toBeInTheDocument();
    expect(titlesShown()).toEqual(["Lighthouse", "Night Shift"]);
    expect(screen.getByText("A keeper finds a message.")).toBeVisible();
  });

  it("asks for the list with the access token of the login", async () => {
    const calls = answerProjectList(projectPage([]));
    await openHome();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer access-1");
  });

  it("tells a person without projects where to start", async () => {
    answerProjectList(projectPage([]));
    await openHome();
    expect(
      await screen.findByText(
        "You have no projects yet. Use the form above to start your first one.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("shows what a person wrote as text, never as markup", async () => {
    answerProjectList(projectPage([makeProject({ title: "<img src=x onerror=alert(1)>" })]));
    await openHome();
    expect(await screen.findByRole("heading", { level: 3 })).toHaveTextContent(
      "<img src=x onerror=alert(1)>",
    );
    expect(document.querySelector("main img")).toBeNull();
  });

  it("says why the list could not be loaded, and loads it again on request", async () => {
    const calls = answerProjectList(
      () => problemResponse(503, "service-unavailable"),
      projectPage([makeProject({ title: "Back again" })]),
    );
    const { user } = await openHome();

    expect(await screen.findByRole("alert")).toHaveTextContent("The service is busy.");
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { level: 3, name: "Back again" })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(calls).toHaveLength(2);
  });
});

describe("AppHomePage: more than one page", () => {
  const pageOne = Array.from({ length: 3 }, (_, i) => makeProject({ title: `Page one, ${i + 1}` }));
  const pageTwo = [makeProject({ title: "Page two, 1" }), makeProject({ title: "Page two, 2" })];

  it("loads the next page on request, moves the focus to its first project and says how many", async () => {
    const calls = answerProjectList(projectPage(pageOne, "cursor-2"), projectPage(pageTwo, null));
    const { user } = await openHome();
    await screen.findByRole("heading", { level: 3, name: "Page one, 1" });

    await user.click(screen.getByRole("button", { name: "Load more projects" }));

    await screen.findByRole("heading", { level: 3, name: "Page two, 1" });
    expect(calls[1]?.url.searchParams.get("cursor")).toBe("cursor-2");
    expect(titlesShown()).toHaveLength(5);
    const firstNew = pageTwo[0];
    await waitFor(() =>
      expect(document.getElementById(projectItemId(firstNew?.id ?? ""))).toHaveFocus(),
    );
    expect(screen.getByText("2 more projects loaded.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more projects" })).not.toBeInTheDocument();
  });

  it("keeps the projects and offers another try when a page fails", async () => {
    answerProjectList(
      projectPage(pageOne, "cursor-2"),
      () => problemResponse(503, "service-unavailable"),
      projectPage(pageTwo, null),
    );
    const { user } = await openHome();
    await screen.findByRole("heading", { level: 3, name: "Page one, 1" });

    await user.click(screen.getByRole("button", { name: "Load more projects" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The service is busy.");
    expect(titlesShown()).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "Load more projects" }));
    await screen.findByRole("heading", { level: 3, name: "Page two, 1" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(titlesShown()).toHaveLength(5);
  });
});

describe("AppHomePage: creating a project", () => {
  it("puts the new project at the top of the list at once, and the form starts again", async () => {
    answerProjectList(projectPage([makeProject({ title: "Older" })]));
    const calls = answerCreateProject(created());
    const { user } = await openHome();
    await screen.findByRole("heading", { level: 3, name: "Older" });

    await user.type(screen.getByLabelText("Title"), "Lighthouse");
    await user.click(screen.getByRole("radio", { name: "Prose" }));
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByText("Project “Lighthouse” created.")).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ title: "Lighthouse", format: "prose" });
    expect(titlesShown()).toEqual(["Lighthouse", "Older"]);
    expect(screen.getByLabelText("Title")).toHaveValue("");
    expect(screen.getByLabelText("Title")).toHaveFocus();
  });

  it("replaces the empty message with the first project", async () => {
    answerProjectList(projectPage([]));
    answerCreateProject(created());
    const { user } = await openHome();
    await screen.findByText(/You have no projects yet/);

    await user.type(screen.getByLabelText("Title"), "First");
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByRole("heading", { level: 3, name: "First" })).toBeVisible();
    expect(screen.queryByText(/You have no projects yet/)).not.toBeInTheDocument();
  });

  it("does not load the list again, and does not show the new project twice", async () => {
    const calls = answerProjectList(projectPage([makeProject({ title: "Older" })]));
    answerCreateProject(created());
    const { user } = await openHome();
    await screen.findByRole("heading", { level: 3, name: "Older" });

    await user.type(screen.getByLabelText("Title"), "Once");
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await screen.findByRole("heading", { level: 3, name: "Once" });

    expect(calls).toHaveLength(1);
    expect(titlesShown().filter((title) => title === "Once")).toHaveLength(1);
  });

  it("keeps what was typed and says why when the API refuses", async () => {
    answerProjectList(projectPage([]));
    answerCreateProject(() => problemResponse(429, "rate-limited", {}, { "retry-after": "5" }));
    const { user } = await openHome();
    await screen.findByText(/You have no projects yet/);

    await user.type(screen.getByLabelText("Title"), "Too fast");
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many requests. Try again in 5 seconds.",
    );
    expect(screen.getByLabelText("Title")).toHaveValue("Too fast");
    expect(screen.getByText(/You have no projects yet/)).toBeVisible();
  });
});

describe("AppHomePage: changing a project", () => {
  const [a, b, c] = [
    makeProject({ title: "Alpha", format: "prose", logline: "First logline." }),
    makeProject({ title: "Beta" }),
    makeProject({ title: "Gamma" }),
  ];

  it("saves a change: the project moves to the top as it is now, and the change is announced", async () => {
    answerProjectList(projectPage([a, b, c]));
    const calls = answerUpdateProject(updated(c));
    const { user } = await openHome();
    await screen.findByRole("heading", { level: 3, name: "Gamma" });

    await user.click(screen.getByRole("button", { name: "Edit project “Gamma”" }));
    const title = editForm("Gamma").getByLabelText("Title");
    expect(title).toHaveFocus();
    await user.clear(title);
    await user.type(title, "Gamma, revised");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("heading", { level: 3, name: "Gamma, revised" })).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.id).toBe(c.id);
    expect(calls[0]?.body).toEqual({ title: "Gamma, revised" });
    expect(titlesShown()).toEqual(["Gamma, revised", "Alpha", "Beta"]);
    expect(screen.getByText("Project “Gamma, revised” saved.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit project “Gamma, revised”" })).toHaveFocus();
  });

  it("does not ask the API for anything when nothing was changed, and says so", async () => {
    answerProjectList(projectPage([a, b]));
    const calls = answerUpdateProject(updated(a));
    const { user } = await openHome();
    await screen.findByRole("heading", { level: 3, name: "Alpha" });

    await user.click(screen.getByRole("button", { name: "Edit project “Alpha”" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("No changes to save.")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    expect(titlesShown()).toEqual(["Alpha", "Beta"]);
    expect(screen.getByRole("button", { name: "Edit project “Alpha”" })).toHaveFocus();
  });

  it("keeps the other projects' open forms and typed text when one is saved", async () => {
    answerProjectList(projectPage([a, b]));
    answerUpdateProject(updated(b));
    const { user } = await openHome();
    await screen.findByRole("heading", { level: 3, name: "Beta" });

    await user.click(screen.getByRole("button", { name: "Edit project “Alpha”" }));
    await user.type(editForm("Alpha").getByLabelText("Title"), " (draft)");
    await user.click(screen.getByRole("button", { name: "Edit project “Beta”" }));
    expect(screen.getAllByRole("form", { name: /^Edit project/ })).toHaveLength(2);
    await user.type(editForm("Beta").getByLabelText("Title"), "!");
    await user.click(editForm("Beta").getByRole("button", { name: "Save changes" }));

    await screen.findByRole("heading", { level: 3, name: "Beta!" });
    // Beta moved to the top; Alpha's form is still open with what was typed.
    expect(editForm("Alpha").getByLabelText("Title")).toHaveValue("Alpha (draft)");
  });

  it("says why a change could not be saved, and keeps the form and the text", async () => {
    answerProjectList(projectPage([a]));
    answerUpdateProject(() => problemResponse(429, "rate-limited", {}, { "retry-after": "20" }));
    const { user } = await openHome();
    await screen.findByRole("heading", { level: 3, name: "Alpha" });

    await user.click(screen.getByRole("button", { name: "Edit project “Alpha”" }));
    await user.type(editForm("Alpha").getByLabelText("Title"), "!");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many requests. Try again in 20 seconds.",
    );
    expect(editForm("Alpha").getByLabelText("Title")).toHaveValue("Alpha!");
  });

  it("shows a changed project in the same place after a reload (the list is sorted by last change)", async () => {
    answerProjectList(projectPage([a, b]));
    const { user } = await openHome();
    await screen.findByRole("heading", { level: 3, name: "Alpha" });
    answerUpdateProject(updated(b));
    await user.click(screen.getByRole("button", { name: "Edit project “Beta”" }));
    await user.type(editForm("Beta").getByLabelText("Title"), "!");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByRole("heading", { level: 3, name: "Beta!" });
    expect(titlesShown()[0]).toBe("Beta!");
  });
});

describe("AppHomePage: deleting a project", () => {
  const [a, b, c] = [
    makeProject({ title: "Alpha" }),
    makeProject({ title: "Beta" }),
    makeProject({ title: "Gamma" }),
  ];

  async function confirmDelete(user: Awaited<ReturnType<typeof openHome>>["user"], title: string) {
    await user.click(screen.getByRole("button", { name: `Delete project “${title}”` }));
    await user.click(screen.getByRole("button", { name: "Delete project" }));
  }

  it("deletes after the question, takes the project out, announces it and moves the focus to the next one", async () => {
    answerProjectList(projectPage([a, b, c]));
    const calls = answerDeleteProject();
    const { user } = await openHome();
    await screen.findByRole("heading", { level: 3, name: "Beta" });

    await confirmDelete(user, "Beta");

    await waitFor(() => expect(titlesShown()).toEqual(["Alpha", "Gamma"]));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.id).toBe(b.id);
    expect(screen.getByText("Project “Beta” deleted.")).toBeInTheDocument();
    expect(document.getElementById(projectItemId(c.id))).toHaveFocus();
  });

  it("moves the focus to the previous project when the last one is deleted", async () => {
    answerProjectList(projectPage([a, b]));
    answerDeleteProject();
    const { user } = await openHome();
    await screen.findByRole("heading", { level: 3, name: "Beta" });

    await confirmDelete(user, "Beta");

    await waitFor(() => expect(titlesShown()).toEqual(["Alpha"]));
    expect(document.getElementById(projectItemId(a.id))).toHaveFocus();
  });

  it("shows the empty message and moves the focus to the list's heading when the only project is deleted", async () => {
    answerProjectList(projectPage([a]));
    answerDeleteProject();
    const { user } = await openHome();
    await screen.findByRole("heading", { level: 3, name: "Alpha" });

    await confirmDelete(user, "Alpha");

    expect(await screen.findByText(/You have no projects yet/)).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "All your projects" })).toHaveFocus();
  });

  it("deletes nothing when the person keeps the project", async () => {
    answerProjectList(projectPage([a, b]));
    const calls = answerDeleteProject();
    const { user } = await openHome();
    await screen.findByRole("heading", { level: 3, name: "Alpha" });

    await user.click(screen.getByRole("button", { name: "Delete project “Alpha”" }));
    await user.click(screen.getByRole("button", { name: "Keep project" }));

    expect(titlesShown()).toEqual(["Alpha", "Beta"]);
    expect(calls).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Delete project “Alpha”" })).toHaveFocus();
  });

  it("takes a project out even when it was already deleted somewhere else (a 404)", async () => {
    answerProjectList(projectPage([a, b]));
    answerDeleteProject(() => problemResponse(404, "not-found"));
    const { user } = await openHome();
    await screen.findByRole("heading", { level: 3, name: "Alpha" });

    await confirmDelete(user, "Alpha");
    await waitFor(() => expect(titlesShown()).toEqual(["Beta"]));
  });

  it("keeps the project and says why when the delete fails", async () => {
    answerProjectList(projectPage([a, b]));
    answerDeleteProject(() => problemResponse(503, "service-unavailable"));
    const { user } = await openHome();
    await screen.findByRole("heading", { level: 3, name: "Alpha" });

    await confirmDelete(user, "Alpha");

    expect(await screen.findByRole("alert")).toHaveTextContent("The service is busy.");
    expect(titlesShown()).toEqual(["Alpha", "Beta"]);
  });

  it("lets the person load more projects after one was deleted, from the same place", async () => {
    const calls = answerProjectList(projectPage([a, b], "cursor-2"), projectPage([c], null));
    answerDeleteProject();
    const { user } = await openHome();
    await screen.findByRole("heading", { level: 3, name: "Alpha" });

    await confirmDelete(user, "Alpha");
    await waitFor(() => expect(titlesShown()).toEqual(["Beta"]));
    await user.click(screen.getByRole("button", { name: "Load more projects" }));

    await screen.findByRole("heading", { level: 3, name: "Gamma" });
    expect(calls[1]?.url.searchParams.get("cursor")).toBe("cursor-2");
    expect(titlesShown()).toEqual(["Beta", "Gamma"]);
  });
});

describe("AppHomePage: accessibility", () => {
  it("has no violations as a page with projects", async () => {
    answerProjectList(
      projectPage([makeProject({ logline: "A logline." }), makeProject()], "cursor-2"),
    );
    await openHome({ signedIn: { displayName: "Ada" } });
    await screen.findAllByRole("heading", { level: 3 });
    await expectNoPageA11yViolations();
  });

  it("has no violations as an empty page", async () => {
    answerProjectList(projectPage([]));
    await openHome();
    await screen.findByText(/You have no projects yet/);
    await expectNoPageA11yViolations();
  });

  it("has no violations while loading", async () => {
    answerProjectList(() => new Promise<Response>(() => undefined));
    await openHome();
    await screen.findByText("Loading your projects…");
    await expectNoPageA11yViolations();
  });

  it("has no violations when the list failed", async () => {
    answerProjectList(() => problemResponse(503, "service-unavailable"));
    await openHome();
    await screen.findByRole("alert");
    await expectNoPageA11yViolations();
  });

  it("has no violations with a problem in the form", async () => {
    answerProjectList(projectPage([]));
    const { user } = await openHome();
    await screen.findByText(/You have no projects yet/);
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await screen.findByRole("alert");
    await expectNoPageA11yViolations();
  });
});
