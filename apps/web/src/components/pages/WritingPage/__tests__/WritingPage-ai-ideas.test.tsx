import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import type { DocumentDetail } from "../../../../lib/api/documents-api.ts";
import {
  answerEstimate,
  answerRunList,
  makeEstimate,
  makeIdea,
  makeIdeasSucceeded,
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

const PROJECT = makeProject({ id: "project-1", title: "The Lighthouse" });
const ACT = makeDocument({ title: "Act One", content: "Act one text.", wordCount: 3 });
const SCENE = makeDocument({
  title: "The Storm",
  parentId: ACT.id,
  content: "Waves crash.",
  wordCount: 2,
});

/** Plants the fake API: the project, its outline and texts, and one earlier idea result with links. */
function plant(documents: readonly DocumentDetail[]) {
  server.use(
    http.get("/projects/:id", () => HttpResponse.json(PROJECT)),
    http.get("/projects/:projectId/documents/:id", ({ params }) => {
      const found = documents.find((document) => document.id === params.id);
      return found ? HttpResponse.json(found) : problemResponse(404, "not-found");
    }),
  );
  answerOutline(documents.map(itemOf));
  answerEstimate(makeEstimate());
  answerRunList(
    page([
      makeIdeasSucceeded(
        [
          makeIdea({
            title: "A new turn",
            goesIn: SCENE.id,
            evidence: [{ documentId: ACT.id, quote: "Act one text.", verified: true }],
          }),
        ],
        { focus: "the ending" },
      ),
    ]),
  );
}

async function openIdeasWithLinks(documentId: string) {
  const view = renderApp({
    route: `/app/projects/project-1?document=${documentId}`,
    signedIn: true,
  });
  await screen.findByRole("heading", { level: 1, name: "The Lighthouse" });
  await view.user.click(await screen.findByRole("button", { name: /AI assistant/ }));
  await view.user.click(await screen.findByRole("button", { name: /^Open the ideas for/ }));
  const ideas = await screen.findByRole("list", { name: "Ideas" });
  return { ...view, ideas };
}

const textOf = (title: string) => screen.findByRole("textbox", { name: `Text of “${title}”` });

describe("WritingPage: links in the ideas of the AI", () => {
  it("moves the focus into the text of the open item when a quote's link is pressed", async () => {
    plant([ACT, SCENE]);
    const { user, ideas } = await openIdeasWithLinks(ACT.id);
    const box = await textOf("Act One");
    expect(box).not.toHaveFocus();

    await user.click(within(ideas).getByRole("link", { name: "Act One" }));
    await waitFor(() => expect(box).toHaveFocus());
  });

  it("opens the item an idea could go into, and puts the focus in its text", async () => {
    plant([ACT, SCENE]);
    const { user, ideas } = await openIdeasWithLinks(ACT.id);
    await textOf("Act One");

    await user.click(within(ideas).getByRole("link", { name: "The Storm" }));
    const box = await textOf("The Storm");
    await waitFor(() => expect(box).toHaveFocus());
    expect(box).toHaveValue("Waves crash.");
  });

  it("shows the kind of each earlier result and the focus that was asked for", async () => {
    plant([ACT, SCENE]);
    await openIdeasWithLinks(ACT.id);
    expect(screen.getByText(/You asked for ideas about:/).closest("p")).toHaveTextContent(
      "the ending",
    );
    expect(
      screen.getByRole("heading", { level: 3, name: /^Ideas for the whole project/ }),
    ).toBeVisible();
  });
});
