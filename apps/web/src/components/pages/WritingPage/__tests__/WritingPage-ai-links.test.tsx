import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import type { DocumentDetail } from "../../../../lib/api/documents-api.ts";
import {
  answerEstimate,
  answerRunList,
  makeEstimate,
  makeFinding,
  makeSucceeded,
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

/** Plants the fake API: the project, its outline and texts, and one earlier scan with two links. */
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
      makeSucceeded([
        makeFinding({
          title: "A contradiction",
          evidence: [
            { documentId: ACT.id, quote: "Act one text.", verified: true },
            { documentId: SCENE.id, quote: "Waves crash.", verified: true },
          ],
        }),
      ]),
    ]),
  );
}

/** Opens the project at one item, opens the panel and then the earlier scan, and returns its links. */
async function openScanWithLinks(documentId: string) {
  const view = renderApp({
    route: `/app/projects/project-1?document=${documentId}`,
    signedIn: true,
  });
  await screen.findByRole("heading", { level: 1, name: "The Lighthouse" });
  await view.user.click(await screen.findByRole("button", { name: /AI assistant/ }));
  await view.user.click(await screen.findByRole("button", { name: /^Open the scan of/ }));
  const findings = await screen.findByRole("list", { name: "Findings" });
  return { ...view, findings };
}

const textOf = (title: string) => screen.findByRole("textbox", { name: `Text of “${title}”` });

describe("WritingPage: links in the findings of an AI scan", () => {
  it("moves the focus into the text of the item that is already open", async () => {
    plant([ACT, SCENE]);
    const { user, findings } = await openScanWithLinks(ACT.id);
    const box = await textOf("Act One");
    // The writer is on the link far below the text, not in the text.
    expect(box).not.toHaveFocus();

    await user.click(within(findings).getByRole("link", { name: "Act One" }));
    await waitFor(() => expect(box).toHaveFocus());
  });

  it("moves it again after the focus has gone somewhere else", async () => {
    plant([ACT, SCENE]);
    const { user, findings } = await openScanWithLinks(ACT.id);
    const box = await textOf("Act One");
    await user.click(within(findings).getByRole("link", { name: "Act One" }));
    await waitFor(() => expect(box).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Close this result" }));
    expect(box).not.toHaveFocus();
    await user.click(await screen.findByRole("button", { name: /^Open the scan of/ }));
    await user.click(
      within(await screen.findByRole("list", { name: "Findings" })).getByRole("link", {
        name: "Act One",
      }),
    );
    await waitFor(() => expect(box).toHaveFocus());
  });

  it("opens another item and puts the focus in its text when it has loaded", async () => {
    plant([ACT, SCENE]);
    const { user, findings } = await openScanWithLinks(ACT.id);
    await textOf("Act One");

    await user.click(within(findings).getByRole("link", { name: "The Storm" }));
    const box = await textOf("The Storm");
    await waitFor(() => expect(box).toHaveFocus());
    expect(box).toHaveValue("Waves crash.");
  });

  it("does not take the focus when a scan is only opened from the history", async () => {
    plant([ACT, SCENE]);
    await openScanWithLinks(ACT.id);
    expect(await textOf("Act One")).not.toHaveFocus();
  });
});
