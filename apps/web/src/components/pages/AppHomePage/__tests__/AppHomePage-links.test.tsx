import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  answerProjectList,
  makeProject,
  projectPage,
} from "../../../../test-support/projects-handlers.ts";
import { renderApp } from "../../../../test-support/render-app.tsx";

describe("AppHomePage: opening a project to write", () => {
  it("makes each project's title a link to its writing screen", async () => {
    const project = makeProject({ title: "The Lighthouse" });
    answerProjectList(projectPage([project]));
    renderApp({ route: "/app", signedIn: true });

    const link = await screen.findByRole("link", { name: "The Lighthouse" });
    expect(link).toHaveAttribute("href", `/app/projects/${project.id}`);
  });

  it("encodes a project id with odd characters", async () => {
    const project = makeProject({ id: "a b/c?d", title: "Odd id" });
    answerProjectList(projectPage([project]));
    renderApp({ route: "/app", signedIn: true });
    expect(await screen.findByRole("link", { name: "Odd id" })).toHaveAttribute(
      "href",
      "/app/projects/a%20b%2Fc%3Fd",
    );
  });
});
