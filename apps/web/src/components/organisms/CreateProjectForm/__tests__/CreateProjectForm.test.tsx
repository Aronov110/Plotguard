import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../../../../lib/auth/session.tsx";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import {
  answerCreateProject,
  created,
  makeProject,
  problemResponse,
} from "../../../../test-support/projects-handlers.ts";
import { deferred } from "../../../../test-support/session-harness.ts";
import { signedInManager } from "../../../../test-support/signed-in-manager.ts";
import { CreateProjectForm } from "../CreateProjectForm.tsx";

async function renderForm() {
  const context = await signedInManager();
  const onCreated = vi.fn();
  const view = render(
    <AuthProvider manager={context.manager}>
      <CreateProjectForm onCreated={onCreated} />
    </AuthProvider>,
  );
  return { ...view, onCreated, user: userEvent.setup() };
}

type User = ReturnType<typeof userEvent.setup>;

const title = () => screen.getByLabelText("Title");
const logline = () => screen.getByRole("textbox", { name: "Logline (optional)" });
const create = () => screen.getByRole("button", { name: "Create project" });

async function fillTitleAndSubmit(user: User, text: string) {
  await user.type(title(), text);
  await user.click(create());
}

describe("CreateProjectForm: what it shows", () => {
  it("has a title, a format, an optional logline and a submit button", async () => {
    await renderForm();
    expect(title()).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Format" })).toBeInTheDocument();
    expect(logline()).toBeInTheDocument();
    expect(create()).toHaveAttribute("type", "submit");
  });

  it("has Screenplay chosen at the start, with all three formats to choose from", async () => {
    await renderForm();
    expect(screen.getByRole("radio", { name: "Screenplay" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Prose" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Other" })).not.toBeChecked();
  });

  it("tells how long the title and the logline may be, as their descriptions", async () => {
    await renderForm();
    expect(title()).toHaveAccessibleDescription("Up to 200 characters.");
    expect(logline()).toHaveAccessibleDescription(
      "One or two sentences about the story. Up to 1,000 characters.",
    );
  });

  it("does not stop typing at a number of characters: the API owns that rule", async () => {
    await renderForm();
    expect(title()).not.toHaveAttribute("maxlength");
    expect(logline()).not.toHaveAttribute("maxlength");
  });

  it("starts without a message or a problem list", async () => {
    await renderForm();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("CreateProjectForm: what the page checks itself", () => {
  it.each([
    ["nothing", ""],
    ["only spaces", "   "],
  ])("asks for a title when there is %s, and sends nothing", async (_name, text) => {
    const calls = answerCreateProject(created());
    const { user, onCreated } = await renderForm();
    if (text !== "") await user.type(title(), text);
    await user.click(create());

    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent("There is a problem");
    expect(summary).toHaveTextContent("Enter a title.");
    expect(title()).toBeInvalid();
    expect(title()).toHaveAccessibleDescription(/Enter a title\./);
    expect(calls).toHaveLength(0);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("moves the focus to the problem list, and the link in it goes to the field", async () => {
    const { user } = await renderForm();
    await user.click(create());
    const summary = await screen.findByRole("alert");
    await waitFor(() => expect(summary).toHaveFocus());

    await user.click(screen.getByRole("link", { name: "Enter a title." }));
    expect(title()).toHaveFocus();
  });

  it("moves the focus to the problem list again for the same problem", async () => {
    const { user } = await renderForm();
    await user.click(create());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
    title().focus();
    await user.click(create());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
  });

  it("asks for a format when none is chosen (a tampered form)", async () => {
    const calls = answerCreateProject(created());
    const { user } = await renderForm();
    for (const radio of screen.getAllByRole("radio")) (radio as HTMLInputElement).value = "movie";
    await fillTitleAndSubmit(user, "Lighthouse");

    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a format.");
    expect(calls).toHaveLength(0);
  });
});

describe("CreateProjectForm: creating a project", () => {
  it("sends the title and the format, tells the page, and starts again", async () => {
    const calls = answerCreateProject(created());
    const { user, onCreated } = await renderForm();
    await fillTitleAndSubmit(user, "Lighthouse");

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ title: "Lighthouse", format: "screenplay" });
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer token-1");
    expect(onCreated.mock.calls[0]?.[0]).toMatchObject({
      title: "Lighthouse",
      format: "screenplay",
    });
  });

  it("sends the chosen format and the logline", async () => {
    const calls = answerCreateProject(created());
    const { user } = await renderForm();
    await user.type(title(), "A novel");
    await user.click(screen.getByRole("radio", { name: "Prose" }));
    await user.type(logline(), "A keeper finds{Enter}a message.");
    await user.click(create());

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toEqual({
      title: "A novel",
      format: "prose",
      logline: "A keeper finds\na message.",
    });
  });

  it("leaves a blank logline out", async () => {
    const calls = answerCreateProject(created());
    const { user } = await renderForm();
    await user.type(title(), "T");
    await user.type(logline(), "   ");
    await user.click(create());

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).not.toHaveProperty("logline");
  });

  it("sends the title as typed: the API trims it, the page does not change it", async () => {
    const calls = answerCreateProject(created());
    const { user } = await renderForm();
    await fillTitleAndSubmit(user, "  Padded  ");
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toMatchObject({ title: "  Padded  " });
  });

  it("can be sent with the Enter key from the title field", async () => {
    const calls = answerCreateProject(created());
    const { user } = await renderForm();
    await user.type(title(), "By keyboard{Enter}");
    await waitFor(() => expect(calls).toHaveLength(1));
  });

  it("empties the fields, chooses Screenplay again and says what was created", async () => {
    answerCreateProject(created());
    const { user } = await renderForm();
    await user.type(title(), "Lighthouse");
    await user.click(screen.getByRole("radio", { name: "Other" }));
    await user.type(logline(), "A logline.");
    await user.click(create());

    expect(await screen.findByText("Project “Lighthouse” created.")).toBeVisible();
    expect(title()).toHaveValue("");
    expect(logline()).toHaveValue("");
    expect(screen.getByRole("radio", { name: "Screenplay" })).toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent("Project “Lighthouse” created.");
  });

  it("moves the focus back to the title, so the next project can be typed at once", async () => {
    answerCreateProject(created());
    const { user } = await renderForm();
    await fillTitleAndSubmit(user, "Lighthouse");
    await screen.findByText("Project “Lighthouse” created.");
    expect(title()).toHaveFocus();
  });

  it("names the project as the server saved it (trimmed), as plain text", async () => {
    answerCreateProject(created());
    const { user } = await renderForm();
    await fillTitleAndSubmit(user, "  <b>Bold</b>  ");
    const status = await screen.findByText(/created\./);
    expect(status).toHaveTextContent("Project “<b>Bold</b>” created.");
    expect(document.querySelector("b")).toBeNull();
  });

  it("clears the message when the next attempt starts", async () => {
    answerCreateProject(created());
    const { user } = await renderForm();
    await fillTitleAndSubmit(user, "One");
    await screen.findByText("Project “One” created.");

    await user.click(create());
    await screen.findByRole("alert");
    expect(screen.queryByText("Project “One” created.")).not.toBeInTheDocument();
  });

  it("can create one project after another", async () => {
    const calls = answerCreateProject(created());
    const { user, onCreated } = await renderForm();
    await fillTitleAndSubmit(user, "One");
    await screen.findByText("Project “One” created.");
    expect(title()).toHaveValue("");
    // user-event remembers the text it typed and does not see the form's own reset(), so it would
    // type "Two" after "One". A browser does not (the end-to-end tests check that); here the
    // library's own memory is cleared first.
    await user.clear(title());
    await fillTitleAndSubmit(user, "Two");
    await screen.findByText("Project “Two” created.");
    expect(calls.map((call) => (call.body as { title: string }).title)).toEqual(["One", "Two"]);
    expect(onCreated).toHaveBeenCalledTimes(2);
  });
});

describe("CreateProjectForm: while it is sending", () => {
  it("says so, shows the button as busy, and sends only once however often it is pressed", async () => {
    const gate = deferred<Response>();
    const calls = answerCreateProject(() => gate.promise);
    const { user, onCreated } = await renderForm();
    await user.type(title(), "Slow");
    await user.click(create());
    await user.click(create());
    await user.type(title(), "{Enter}");

    expect(await screen.findByText("Creating your project…")).toBeVisible();
    expect(create()).toHaveAttribute("aria-busy", "true");
    expect(calls).toHaveLength(1);

    gate.resolve(HttpResponse.json(makeProject({ title: "Slow" }), { status: 201 }));
    await screen.findByText("Project “Slow” created.");
    expect(calls).toHaveLength(1);
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(create()).not.toHaveAttribute("aria-busy");
  });

  it("sends only once when the form itself is submitted twice in a row, not through the button", async () => {
    const gate = deferred<Response>();
    const calls = answerCreateProject(() => gate.promise);
    const { user, onCreated } = await renderForm();
    await user.type(title(), "Twice");

    // Two submissions in the same moment, before the page has drawn the busy button.
    const form = document.querySelector("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(calls).toHaveLength(1));
    gate.resolve(HttpResponse.json(makeProject({ title: "Twice" }), { status: 201 }));
    await screen.findByText("Project “Twice” created.");
    expect(calls).toHaveLength(1);
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("is ready to send again after a failure", async () => {
    const calls = answerCreateProject(() => problemResponse(503, "service-unavailable"));
    const { user } = await renderForm();
    await fillTitleAndSubmit(user, "Again");
    await screen.findByRole("alert");
    expect(create()).not.toHaveAttribute("aria-busy");
    await user.click(create());
    await waitFor(() => expect(calls).toHaveLength(2));
  });
});

describe("CreateProjectForm: when the API says no", () => {
  it("puts each field's message under it and in the list, and keeps what was typed", async () => {
    answerCreateProject(() =>
      problemResponse(400, "validation-error", {
        errors: [
          {
            source: "body",
            pointer: "/title",
            message: "The title can be at most 200 characters.",
          },
          {
            source: "body",
            pointer: "/logline",
            message: "The logline can be at most 1000 characters.",
          },
        ],
      }),
    );
    const { user, onCreated } = await renderForm();
    await user.type(title(), "A long title");
    await user.click(screen.getByRole("radio", { name: "Other" }));
    await user.type(logline(), "A long logline");
    await user.click(create());

    const summary = await screen.findByRole("alert");
    await waitFor(() => expect(summary).toHaveFocus());
    expect(summary).toHaveTextContent("The title can be at most 200 characters.");
    expect(summary).toHaveTextContent("The logline can be at most 1000 characters.");
    expect(title()).toBeInvalid();
    expect(logline()).toBeInvalid();
    expect(title()).toHaveValue("A long title");
    expect(logline()).toHaveValue("A long logline");
    expect(screen.getByRole("radio", { name: "Other" })).toBeChecked();
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("lists a problem that belongs to no field, without marking a field", async () => {
    answerCreateProject(() =>
      problemResponse(400, "validation-error", {
        errors: [{ source: "body", pointer: "/surprise", message: "Something odd." }],
      }),
    );
    const { user } = await renderForm();
    await fillTitleAndSubmit(user, "T");
    expect(await screen.findByRole("alert")).toHaveTextContent("Something odd.");
    expect(title()).not.toBeInvalid();
  });

  it("says how long to wait when there are too many requests", async () => {
    answerCreateProject(() => problemResponse(429, "rate-limited", {}, { "retry-after": "30" }));
    const { user } = await renderForm();
    await fillTitleAndSubmit(user, "T");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many requests. Try again in 30 seconds.",
    );
    expect(title()).toHaveValue("T");
  });

  it("says that the server cannot be reached", async () => {
    answerCreateProject(() => HttpResponse.error());
    const { user } = await renderForm();
    await fillTitleAndSubmit(user, "T");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Can't reach the server. Check your connection and try again.",
    );
    expect(title()).toHaveValue("T");
  });

  it("says that the login has ended after a 401 that renewing did not cure", async () => {
    answerCreateProject(() => problemResponse(401, "unauthorized"));
    const { user } = await renderForm();
    await fillTitleAndSubmit(user, "T");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your login has ended. Please log in again.",
    );
  });

  it("gives one general sentence for a server error, never its technical text", async () => {
    answerCreateProject(() =>
      problemResponse(500, "internal-error", { detail: "stack trace SECRET" }),
    );
    const { user } = await renderForm();
    await fillTitleAndSubmit(user, "T");
    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent("Something went wrong. Please try again.");
    expect(summary).not.toHaveTextContent("SECRET");
  });

  it("logs an answer in the wrong shape, and shows only the general sentence", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      answerCreateProject(() => HttpResponse.json({ nonsense: "SECRET" }, { status: 201 }));
      const { user, onCreated } = await renderForm();
      await fillTitleAndSubmit(user, "T");
      const summary = await screen.findByRole("alert");
      expect(summary).toHaveTextContent("Something went wrong. Please try again.");
      expect(summary).not.toHaveTextContent("SECRET");
      expect(log).toHaveBeenCalledTimes(1);
      expect(onCreated).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("does not log an expected refusal", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      answerCreateProject(() => problemResponse(503, "service-unavailable"));
      const { user } = await renderForm();
      await fillTitleAndSubmit(user, "T");
      await screen.findByRole("alert");
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("clears the problems when the next attempt works", async () => {
    let attempts = 0;
    answerCreateProject((body) => {
      attempts += 1;
      return attempts === 1 ? problemResponse(503, "service-unavailable") : created()(body);
    });
    const { user, onCreated } = await renderForm();
    await fillTitleAndSubmit(user, "Retry");
    await screen.findByRole("alert");

    await user.click(create());
    await screen.findByText("Project “Retry” created.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onCreated).toHaveBeenCalledTimes(1);
  });
});

describe("CreateProjectForm: accessibility", () => {
  it("has no violations at the start", async () => {
    const { container } = await renderForm();
    await expectNoA11yViolations(container);
  });

  it("has no violations with problems shown", async () => {
    const { container, user } = await renderForm();
    await user.click(create());
    await screen.findByRole("alert");
    await expectNoA11yViolations(container);
  });

  it("has no violations after a success", async () => {
    answerCreateProject(created());
    const { container, user } = await renderForm();
    await fillTitleAndSubmit(user, "Fine");
    await screen.findByText("Project “Fine” created.");
    await expectNoA11yViolations(container);
  });
});
