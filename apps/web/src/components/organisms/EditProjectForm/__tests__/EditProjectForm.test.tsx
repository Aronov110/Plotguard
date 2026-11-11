import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../../../../lib/auth/session.tsx";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import {
  answerUpdateProject,
  makeProject,
  problemResponse,
  updated,
} from "../../../../test-support/projects-handlers.ts";
import { deferred } from "../../../../test-support/session-harness.ts";
import { signedInManager } from "../../../../test-support/signed-in-manager.ts";
import { EditProjectForm } from "../EditProjectForm.tsx";

const PROJECT = makeProject({
  title: "The Lighthouse",
  format: "prose",
  logline: "A keeper finds a message.",
});

async function renderForm(project = PROJECT) {
  const context = await signedInManager();
  const onSaved = vi.fn();
  const onUnchanged = vi.fn();
  const onCancel = vi.fn();
  const view = render(
    <AuthProvider manager={context.manager}>
      <EditProjectForm
        project={project}
        onSaved={onSaved}
        onUnchanged={onUnchanged}
        onCancel={onCancel}
      />
    </AuthProvider>,
  );
  return { ...view, onSaved, onUnchanged, onCancel, user: userEvent.setup() };
}

const title = () => screen.getByLabelText("Title");
const logline = () => screen.getByRole("textbox", { name: "Logline (optional)" });
const save = () => screen.getByRole("button", { name: "Save changes" });

describe("EditProjectForm: what it shows", () => {
  it("is a form named after the project", async () => {
    await renderForm();
    expect(screen.getByRole("form", { name: "Edit project “The Lighthouse”" })).toBeVisible();
  });

  it("opens with the project's own values in the fields", async () => {
    await renderForm();
    expect(title()).toHaveValue("The Lighthouse");
    expect(screen.getByRole("radio", { name: "Prose" })).toBeChecked();
    expect(logline()).toHaveValue("A keeper finds a message.");
  });

  it("shows an empty logline field for a project that has none", async () => {
    await renderForm(makeProject({ logline: null }));
    expect(logline()).toHaveValue("");
  });

  it("opens with the focus on the title, so the person can start typing", async () => {
    await renderForm();
    expect(title()).toHaveFocus();
  });

  it("has a Save changes button and a Cancel button, and no message or problem list", async () => {
    await renderForm();
    expect(save()).toHaveAttribute("type", "submit");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute("type", "button");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("EditProjectForm: saving", () => {
  it("sends only the title when only the title changed, and tells the list the saved project", async () => {
    const calls = answerUpdateProject(updated(PROJECT));
    const { user, onSaved } = await renderForm();
    await user.clear(title());
    await user.type(title(), "The Old Lighthouse");
    await user.click(save());

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.id).toBe(PROJECT.id);
    expect(calls[0]?.body).toEqual({ title: "The Old Lighthouse" });
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer token-1");
    expect(onSaved.mock.calls[0]?.[0]).toMatchObject({
      id: PROJECT.id,
      title: "The Old Lighthouse",
    });
  });

  it("sends only the format when only the format changed", async () => {
    const calls = answerUpdateProject(updated(PROJECT));
    const { user, onSaved } = await renderForm();
    await user.click(screen.getByRole("radio", { name: "Other" }));
    await user.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls[0]?.body).toEqual({ format: "other" });
  });

  it("sends null when the logline is cleared", async () => {
    const calls = answerUpdateProject(updated(PROJECT));
    const { user, onSaved } = await renderForm();
    await user.clear(logline());
    await user.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls[0]?.body).toEqual({ logline: null });
  });

  it("sends all three when all three changed", async () => {
    const calls = answerUpdateProject(updated(PROJECT));
    const { user, onSaved } = await renderForm();
    await user.clear(title());
    await user.type(title(), "New");
    await user.click(screen.getByRole("radio", { name: "Screenplay" }));
    await user.clear(logline());
    await user.type(logline(), "New logline.");
    await user.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls[0]?.body).toEqual({
      title: "New",
      format: "screenplay",
      logline: "New logline.",
    });
  });

  it("sends nothing when nothing changed, and says so", async () => {
    const calls = answerUpdateProject(updated(PROJECT));
    const { user, onSaved, onUnchanged } = await renderForm();
    await user.click(save());
    await waitFor(() => expect(onUnchanged).toHaveBeenCalledTimes(1));
    expect(calls).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("counts spaces around the title as no change", async () => {
    const calls = answerUpdateProject(updated(PROJECT));
    const { user, onUnchanged } = await renderForm();
    await user.type(title(), "   ");
    await user.click(save());
    await waitFor(() => expect(onUnchanged).toHaveBeenCalledTimes(1));
    expect(calls).toHaveLength(0);
  });

  it("can be saved with the Enter key from the title field", async () => {
    const calls = answerUpdateProject(updated(PROJECT));
    const { user, onSaved } = await renderForm();
    await user.type(title(), "!{Enter}");
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(calls[0]?.body).toEqual({ title: "The Lighthouse!" });
  });

  it("cancels without asking the API for anything", async () => {
    const calls = answerUpdateProject(updated(PROJECT));
    const { user, onCancel, onSaved } = await renderForm();
    await user.type(title(), " changed");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
});

describe("EditProjectForm: what the page checks itself", () => {
  it.each([
    ["nothing", ""],
    ["only spaces", "   "],
  ])("asks for a title when there is %s, and sends nothing", async (_name, text) => {
    const calls = answerUpdateProject(updated(PROJECT));
    const { user, onSaved } = await renderForm();
    await user.clear(title());
    if (text !== "") await user.type(title(), text);
    await user.click(save());

    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent("Enter a title.");
    await waitFor(() => expect(summary).toHaveFocus());
    expect(title()).toBeInvalid();
    expect(calls).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("EditProjectForm: while it is sending", () => {
  it("says so, shows the button as busy, and sends only once however the form is submitted", async () => {
    const gate = deferred<Response>();
    const calls = answerUpdateProject(() => gate.promise);
    const { user, onSaved } = await renderForm();
    await user.type(title(), "!");

    const form = screen.getByRole("form");
    fireEvent.submit(form);
    fireEvent.submit(form);
    await user.click(save());

    expect(await screen.findByText("Saving your changes…")).toBeVisible();
    expect(save()).toHaveAttribute("aria-busy", "true");
    expect(calls).toHaveLength(1);

    gate.resolve(HttpResponse.json({ ...PROJECT, title: "The Lighthouse!" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(calls).toHaveLength(1);
  });
});

describe("EditProjectForm: when the API says no", () => {
  async function failWith(reply: Parameters<typeof answerUpdateProject>[0]) {
    answerUpdateProject(reply);
    const rendered = await renderForm();
    await rendered.user.type(title(), "!");
    await rendered.user.click(save());
    return rendered;
  }

  it("puts each field's message under it and in the list, and keeps what was typed", async () => {
    const { onSaved } = await failWith(() =>
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
            message: "The logline cannot contain a null character.",
          },
        ],
      }),
    );
    const summary = await screen.findByRole("alert");
    await waitFor(() => expect(summary).toHaveFocus());
    expect(summary).toHaveTextContent("The title can be at most 200 characters.");
    expect(summary).toHaveTextContent("The logline cannot contain a null character.");
    expect(title()).toBeInvalid();
    expect(logline()).toBeInvalid();
    expect(title()).toHaveValue("The Lighthouse!");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("says that the project no longer exists after a 404", async () => {
    await failWith(() => problemResponse(404, "not-found"));
    expect(await screen.findByRole("alert")).toHaveTextContent("This project no longer exists.");
  });

  it("says how long to wait when there are too many requests", async () => {
    await failWith(() => problemResponse(429, "rate-limited", {}, { "retry-after": "12" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many requests. Try again in 12 seconds.",
    );
  });

  it("says that the server cannot be reached", async () => {
    await failWith(() => HttpResponse.error());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Can't reach the server. Check your connection and try again.",
    );
    expect(title()).toHaveValue("The Lighthouse!");
  });

  it("gives one general sentence for a server error, never its technical text", async () => {
    await failWith(() => problemResponse(500, "internal-error", { detail: "stack SECRET" }));
    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent("Something went wrong. Please try again.");
    expect(summary).not.toHaveTextContent("SECRET");
  });

  it("logs an answer in the wrong shape, and shows only the general sentence", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { onSaved } = await failWith(() => HttpResponse.json({ nonsense: "SECRET" }));
      const summary = await screen.findByRole("alert");
      expect(summary).toHaveTextContent("Something went wrong. Please try again.");
      expect(summary).not.toHaveTextContent("SECRET");
      expect(log).toHaveBeenCalledTimes(1);
      expect(onSaved).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("can be sent again after a failure, and the problems go away", async () => {
    let attempts = 0;
    answerUpdateProject((id, body) => {
      attempts += 1;
      return attempts === 1
        ? problemResponse(503, "service-unavailable")
        : updated(PROJECT)(id, body);
    });
    const { user, onSaved } = await renderForm();
    await user.type(title(), "!");
    await user.click(save());
    await screen.findByRole("alert");

    await user.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("EditProjectForm: text", () => {
  it("shows markup in the title as text, in the field and in the form's name", async () => {
    await renderForm(makeProject({ title: "<img src=x onerror=alert(1)>" }));
    expect(title()).toHaveValue("<img src=x onerror=alert(1)>");
    expect(document.querySelector("img")).toBeNull();
    expect(
      screen.getByRole("form", { name: "Edit project “<img src=x onerror=alert(1)>”" }),
    ).toBeVisible();
  });
});

describe("EditProjectForm: accessibility", () => {
  it("has no violations at the start", async () => {
    const { container } = await renderForm();
    await expectNoA11yViolations(container);
  });

  it("has no violations with problems shown", async () => {
    const { container, user } = await renderForm();
    await user.clear(title());
    await user.click(save());
    await screen.findByRole("alert");
    await expectNoA11yViolations(container);
  });
});
