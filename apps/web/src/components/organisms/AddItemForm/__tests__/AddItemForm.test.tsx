import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../../../../lib/auth/session.tsx";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import {
  answerCreateDocument,
  createdDocument,
  makeDocument,
} from "../../../../test-support/documents-handlers.ts";
import { problemResponse } from "../../../../test-support/projects-handlers.ts";
import { deferred } from "../../../../test-support/session-harness.ts";
import { signedInManager } from "../../../../test-support/signed-in-manager.ts";
import { AddItemForm, type AddItemFormProps } from "../AddItemForm.tsx";

async function renderForm(inside: AddItemFormProps["inside"] = undefined) {
  const context = await signedInManager();
  const onAdded = vi.fn();
  const element = (next: AddItemFormProps["inside"]) => (
    <AuthProvider manager={context.manager}>
      <AddItemForm projectId="project-1" inside={next} onAdded={onAdded} />
    </AuthProvider>
  );
  const view = render(element(inside));
  return {
    ...view,
    onAdded,
    user: userEvent.setup(),
    openAct: (next: AddItemFormProps["inside"]) => {
      view.rerender(element(next));
    },
  };
}

const title = () => screen.getByLabelText("Title");
const add = () => screen.getByRole("button", { name: "Add to the outline" });
const ACT = { id: "act-1", title: "Act One" };

describe("AddItemForm: what it shows", () => {
  it("has a heading, a title field and an Add button", async () => {
    await renderForm();
    expect(screen.getByRole("heading", { level: 2, name: "Add to the outline" })).toBeVisible();
    expect(title()).toBeVisible();
    expect(add()).toHaveAttribute("type", "submit");
  });

  it("explains that a top-level item is an act or a chapter, when no act is open", async () => {
    await renderForm();
    expect(screen.getByText(/added at the top level, as an act or a chapter/)).toBeVisible();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("offers to add a scene inside the open act, chosen by default", async () => {
    await renderForm(ACT);
    expect(screen.getByRole("group", { name: "Where to add it" })).toBeVisible();
    expect(screen.getByRole("radio", { name: "Inside “Act One”" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "At the top level" })).not.toBeChecked();
  });

  it("starts the choice again when another act is opened", async () => {
    const { user, openAct } = await renderForm(ACT);
    await user.click(screen.getByRole("radio", { name: "At the top level" }));
    openAct({ id: "act-2", title: "Act Two" });
    expect(screen.getByRole("radio", { name: "Inside “Act Two”" })).toBeChecked();
  });

  it("shows the act's title as plain text", async () => {
    await renderForm({ id: "x", title: "<b>Bold</b>" });
    expect(screen.getByRole("radio", { name: "Inside “<b>Bold</b>”" })).toBeVisible();
    expect(document.querySelector("b")).toBeNull();
  });

  it("hints how the title is used", async () => {
    await renderForm();
    expect(title()).toHaveAccessibleDescription("The name of the new act, chapter or scene.");
  });
});

describe("AddItemForm: adding", () => {
  it("adds an act or a chapter at the top level when no act is open", async () => {
    const calls = answerCreateDocument(createdDocument());
    const { user, onAdded } = await renderForm();
    await user.type(title(), "Act One");
    await user.click(add());

    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.projectId).toBe("project-1");
    expect(calls[0]?.body).toEqual({ title: "Act One" });
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer token-1");
    expect(onAdded.mock.calls[0]?.[0]).toMatchObject({ title: "Act One" });
  });

  it("adds a scene inside the open act by default", async () => {
    const calls = answerCreateDocument(createdDocument());
    const { user, onAdded } = await renderForm(ACT);
    await user.type(title(), "Scene 1");
    await user.click(add());
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(calls[0]?.body).toEqual({ title: "Scene 1", parentId: "act-1" });
  });

  it("adds at the top level when that is chosen, even with an act open", async () => {
    const calls = answerCreateDocument(createdDocument());
    const { user, onAdded } = await renderForm(ACT);
    await user.click(screen.getByRole("radio", { name: "At the top level" }));
    await user.type(title(), "Act Two");
    await user.click(add());
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(calls[0]?.body).toEqual({ title: "Act Two" });
  });

  it("sends the title as typed: the API trims it", async () => {
    const calls = answerCreateDocument(createdDocument());
    const { user, onAdded } = await renderForm();
    await user.type(title(), "  Padded  ");
    await user.click(add());
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(calls[0]?.body).toEqual({ title: "  Padded  " });
  });

  it("can be sent with the Enter key from the title field", async () => {
    const calls = answerCreateDocument(createdDocument());
    const { user, onAdded } = await renderForm();
    await user.type(title(), "By keyboard{Enter}");
    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    expect(calls).toHaveLength(1);
  });

  it("empties the title after a success, ready for the next item", async () => {
    answerCreateDocument(createdDocument());
    const { user, onAdded } = await renderForm();
    await user.type(title(), "First");
    await user.click(add());
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(title()).toHaveValue("");
  });

  it("sends once however often it is pressed while it runs, and says it is busy", async () => {
    const gate = deferred<Response>();
    const calls = answerCreateDocument(() => gate.promise);
    const { user, onAdded } = await renderForm();
    await user.type(title(), "Slow");
    await user.click(add());
    await user.click(add());
    await user.type(title(), "{Enter}");

    expect(add()).toHaveAttribute("aria-busy", "true");
    expect(calls).toHaveLength(1);
    gate.resolve(HttpResponse.json(makeDocument({ title: "Slow" }), { status: 201 }));
    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    expect(calls).toHaveLength(1);
  });
});

describe("AddItemForm: what the page checks itself", () => {
  it.each([
    ["nothing", ""],
    ["only spaces", "   "],
  ])("asks for a title when there is %s, and sends nothing", async (_name, text) => {
    const calls = answerCreateDocument(createdDocument());
    const { user, onAdded } = await renderForm();
    if (text !== "") await user.type(title(), text);
    await user.click(add());

    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent("Enter a title.");
    await waitFor(() => expect(summary).toHaveFocus());
    expect(title()).toBeInvalid();
    expect(calls).toHaveLength(0);
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("moves the focus to the problem list again for the same problem", async () => {
    const { user } = await renderForm();
    await user.click(add());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
    title().focus();
    await user.click(add());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
  });

  it("links the problem to the title field", async () => {
    const { user } = await renderForm();
    await user.click(add());
    await user.click(await screen.findByRole("link", { name: "Enter a title." }));
    expect(title()).toHaveFocus();
  });
});

describe("AddItemForm: when the API says no", () => {
  async function failWith(reply: Parameters<typeof answerCreateDocument>[0]) {
    answerCreateDocument(reply);
    const rendered = await renderForm();
    await rendered.user.type(title(), "A title");
    await rendered.user.click(add());
    return rendered;
  }

  it("puts the API's message under the title and keeps what was typed", async () => {
    const { onAdded } = await failWith(() =>
      problemResponse(400, "validation-error", {
        errors: [{ source: "body", pointer: "/title", message: "The title is too long." }],
      }),
    );
    const summary = await screen.findByRole("alert");
    await waitFor(() => expect(summary).toHaveFocus());
    expect(summary).toHaveTextContent("The title is too long.");
    expect(title()).toBeInvalid();
    expect(title()).toHaveValue("A title");
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("says that the outline is full after a 409", async () => {
    await failWith(() => problemResponse(409, "conflict"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The outline is full: a project can have at most 1,000 items.",
    );
  });

  it("says that the project no longer exists after a 404", async () => {
    await failWith(() => problemResponse(404, "not-found"));
    expect(await screen.findByRole("alert")).toHaveTextContent("This project no longer exists.");
  });

  it("says how long to wait when there are too many changes", async () => {
    await failWith(() => problemResponse(429, "rate-limited", {}, { "retry-after": "9" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many changes in a short time. Trying again in 9 seconds.",
    );
  });

  it("says that the server cannot be reached", async () => {
    await failWith(() => HttpResponse.error());
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");
  });

  it("logs an answer in the wrong shape, and shows only a general sentence", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await failWith(() => HttpResponse.json({ nonsense: "SECRET" }, { status: 201 }));
      const summary = await screen.findByRole("alert");
      expect(summary).toHaveTextContent("Something went wrong. Please try again.");
      expect(summary).not.toHaveTextContent("SECRET");
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });

  it("does not log an expected refusal", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await failWith(() => problemResponse(409, "conflict"));
      await screen.findByRole("alert");
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});

describe("AddItemForm: accessibility", () => {
  it("has no violations plain, with an act open, and with a problem", async () => {
    const { container, user } = await renderForm(ACT);
    await expectNoA11yViolations(container);
    await user.click(add());
    await screen.findByRole("alert");
    await expectNoA11yViolations(container);
  });

  it("has no violations when no act is open", async () => {
    const { container } = await renderForm();
    await expectNoA11yViolations(container);
  });
});
