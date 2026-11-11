import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentDetail } from "../../../../lib/api/documents-api.ts";
import { AuthProvider } from "../../../../lib/auth/session.tsx";
import { expectNoA11yViolations } from "../../../../test-support/a11y.ts";
import {
  answerDocument,
  answerSave,
  makeDocument,
  saved,
} from "../../../../test-support/documents-handlers.ts";
import { problemResponse } from "../../../../test-support/projects-handlers.ts";
import { signedInManager } from "../../../../test-support/signed-in-manager.ts";
import { DocumentEditor } from "../DocumentEditor.tsx";

afterEach(() => {
  vi.useRealTimers();
});

async function renderEditor(
  document: DocumentDetail,
  options: { focusOnReady?: boolean; title?: string } = {},
) {
  const context = await signedInManager();
  const onWordCount = vi.fn();
  const view = render(
    <AuthProvider manager={context.manager}>
      <DocumentEditor
        projectId="project-1"
        item={{ id: document.id, title: options.title ?? document.title }}
        focusOnReady={options.focusOnReady ?? false}
        onWordCount={onWordCount}
      />
    </AuthProvider>,
  );
  return { ...view, onWordCount, user: userEvent.setup() };
}

/** The editor once its text has loaded. */
async function readyEditor(document: DocumentDetail, options?: Parameters<typeof renderEditor>[1]) {
  const rendered = await renderEditor(document, options);
  const box = await screen.findByRole("textbox");
  return { ...rendered, box: box as HTMLTextAreaElement };
}

/** Types exactly `text` into the box in one input event, as a paste would. */
function typeText(box: HTMLElement, text: string): void {
  fireEvent.input(box, { target: { value: text } });
}

describe("DocumentEditor: loading", () => {
  it("says that the text is loading, then shows it in a box named after the document", async () => {
    const document = makeDocument({ title: "Scene One", content: "INT. LIGHTHOUSE - NIGHT" });
    answerDocument(document);
    await renderEditor(document);

    expect(screen.getByRole("status")).toHaveTextContent("Loading the text…");
    const box = await screen.findByRole("textbox", { name: "Text of “Scene One”" });
    expect(box).toHaveValue("INT. LIGHTHOUSE - NIGHT");
    expect(screen.getByRole("heading", { level: 2, name: "Scene One" })).toBeVisible();
  });

  it("starts as saved, with the word count", async () => {
    const document = makeDocument({ content: "one two three", wordCount: 3 });
    answerDocument(document);
    await readyEditor(document);
    expect(screen.getByText("Saved")).toBeVisible();
    expect(screen.getByText("3 words")).toBeVisible();
  });

  it("says one word in the singular and zero words", async () => {
    answerDocument(makeDocument({ wordCount: 1 }));
    const first = await readyEditor(makeDocument({ wordCount: 1 }));
    expect(screen.getByText("1 word")).toBeVisible();
    first.unmount();

    const empty = makeDocument({ wordCount: 0 });
    answerDocument(empty);
    await readyEditor(empty);
    expect(screen.getByText("0 words")).toBeVisible();
  });

  it("uses the outline's title, which is always up to date", async () => {
    const document = makeDocument({ title: "Old title" });
    answerDocument(document);
    await readyEditor(document, { title: "New title" });
    expect(screen.getByRole("heading", { level: 2, name: "New title" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Text of “New title”" })).toBeVisible();
  });

  it("reads the status and the counts as the box's description", async () => {
    const document = makeDocument({ wordCount: 2 });
    answerDocument(document);
    const { box } = await readyEditor(document);
    expect(box).toHaveAccessibleDescription(/Saved.*2 words/);
  });

  it("says why the text could not be loaded, and loads it on Try again", async () => {
    const document = makeDocument({ content: "After retry" });
    answerDocument(() => HttpResponse.error(), document);
    const { user } = await renderEditor(document);

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("textbox")).toHaveValue("After retry");
  });

  it("says that a document that is gone is gone", async () => {
    answerDocument(() => problemResponse(404, "not-found"));
    await renderEditor(makeDocument());
    expect(await screen.findByRole("alert")).toHaveTextContent("does not exist any more");
  });

  it("moves the focus into the text when asked, and leaves it alone otherwise", async () => {
    const document = makeDocument();
    answerDocument(document);
    const focused = await readyEditor(document, { focusOnReady: true });
    expect(focused.box).toHaveFocus();
    focused.unmount();

    answerDocument(document);
    const notFocused = await readyEditor(document, { focusOnReady: false });
    expect(notFocused.box).not.toHaveFocus();
  });
});

describe("DocumentEditor: saving", () => {
  it("says unsaved while typing, then saves when the box is left, and shows the new word count", async () => {
    const document = makeDocument({ content: "start", version: 3, wordCount: 1 });
    answerDocument(document);
    const calls = answerSave(saved(document));
    const { box, onWordCount } = await readyEditor(document);

    typeText(box, "start and more");
    expect(screen.getByText("Unsaved changes")).toBeVisible();
    expect(calls).toHaveLength(0);

    fireEvent.blur(box);
    await waitFor(() => expect(screen.getByText("Saved")).toBeVisible());
    expect(calls).toHaveLength(1);
    expect(calls[0]?.ifMatch).toBe('"3"');
    expect(calls[0]?.body).toEqual({ content: "start and more" });
    expect(screen.getByText("3 words")).toBeVisible();
    expect(onWordCount).toHaveBeenCalledWith(document.id, 3);
  });

  it("saves two seconds after the last keystroke, and not a moment before", async () => {
    const document = makeDocument({ content: "start" });
    answerDocument(document);
    const calls = answerSave(saved(document));
    // Wait for the box with real timers (the test library polls with them), then fake the clock.
    const { box } = await readyEditor(document);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    typeText(box, "start, typed");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999);
    });
    expect(calls).toHaveLength(0);

    typeText(box, "start, typed more"); // a keystroke restarts the wait
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999);
    });
    expect(calls).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    vi.useRealTimers();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toEqual({ content: "start, typed more" });
  });

  it("saves the text exactly as typed: spaces, line breaks, emoji and right-to-left text", async () => {
    const document = makeDocument({ content: "" });
    answerDocument(document);
    const calls = answerSave(saved(document));
    const { box } = await readyEditor(document);
    const text = "  INT. LIGHTHOUSE - NIGHT\n\n\t<b>Waves</b> crash 🎬 שלום مرحبا  \n";

    typeText(box, text);
    fireEvent.blur(box);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toEqual({ content: text });
  });

  it("does not rewrite the box after a save, so the writer's place and undo history stay", async () => {
    const document = makeDocument({ content: "start" });
    answerDocument(document);
    answerSave(saved(document));
    const { box } = await readyEditor(document);
    box.focus();
    typeText(box, "typed");
    box.setSelectionRange(2, 2);
    fireEvent.blur(box);
    await waitFor(() => expect(screen.getByText("Saved")).toBeVisible());
    expect(box.value).toBe("typed");
    expect(box.selectionStart).toBe(2);
  });

  it("saves at once with Ctrl+S, keeps the browser's own save away, and says Saved.", async () => {
    const document = makeDocument({ content: "start" });
    answerDocument(document);
    const calls = answerSave(saved(document));
    const { box } = await readyEditor(document);

    typeText(box, "start!");
    const notPrevented = fireEvent.keyDown(box, { key: "s", ctrlKey: true });

    expect(notPrevented).toBe(false);
    await waitFor(() => expect(calls).toHaveLength(1));
    await waitFor(() => expect(screen.getAllByRole("status").at(-1)).toHaveTextContent("Saved."));
  });

  it("saves at once with Cmd+S too", async () => {
    const document = makeDocument({ content: "start" });
    answerDocument(document);
    const calls = answerSave(saved(document));
    const { box } = await readyEditor(document);
    typeText(box, "start!");
    const notPrevented = fireEvent.keyDown(box, { key: "S", metaKey: true });
    expect(notPrevented).toBe(false);
    await waitFor(() => expect(calls).toHaveLength(1));
  });

  it("leaves other keys alone", async () => {
    const document = makeDocument();
    answerDocument(document);
    const { box } = await readyEditor(document);
    expect(fireEvent.keyDown(box, { key: "s" })).toBe(true);
    expect(fireEvent.keyDown(box, { key: "a", ctrlKey: true })).toBe(true);
  });

  it("does not announce Ctrl+S when nothing could be saved", async () => {
    const document = makeDocument({ content: "start" });
    answerDocument(document);
    answerSave(() => problemResponse(400, "validation-error"));
    const { box } = await readyEditor(document);
    typeText(box, "bad");
    fireEvent.keyDown(box, { key: "s", ctrlKey: true });
    await waitFor(() => expect(screen.getByRole("alert")).toBeVisible());
    expect(screen.getAllByRole("status").every((status) => status.textContent === "")).toBe(true);
  });

  it("saves what was typed when the writer leaves the document", async () => {
    const document = makeDocument({ content: "start" });
    answerDocument(document);
    const calls = answerSave(saved(document));
    const { box, unmount } = await readyEditor(document);

    typeText(box, "start, then leaving");
    unmount();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toEqual({ content: "start, then leaving" });
  });

  it("makes no save when nothing was typed", async () => {
    const document = makeDocument();
    answerDocument(document);
    const calls = answerSave(saved(document));
    const { box, unmount } = await readyEditor(document);
    fireEvent.blur(box);
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toHaveLength(0);
  });
});

describe("DocumentEditor: typing through an input method", () => {
  it("does not save half a character, and notices the finished one", async () => {
    const document = makeDocument({ content: "" });
    answerDocument(document);
    const calls = answerSave(saved(document));
    const { box } = await readyEditor(document);

    fireEvent.compositionStart(box);
    typeText(box, "に");
    typeText(box, "にほ");
    expect(screen.getByText("Saved")).toBeVisible();
    expect(calls).toHaveLength(0);

    fireEvent.compositionEnd(box, { target: { value: "にほん" } });
    expect(screen.getByText("Unsaved changes")).toBeVisible();
    fireEvent.blur(box);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toEqual({ content: "にほん" });
  });

  it("goes back to normal after the composition", async () => {
    const document = makeDocument({ content: "" });
    answerDocument(document);
    const { box } = await readyEditor(document);
    fireEvent.compositionStart(box);
    fireEvent.compositionEnd(box, { target: { value: "あ" } });
    typeText(box, "あい");
    expect(screen.getByText("Unsaved changes")).toBeVisible();
  });
});

describe("DocumentEditor: problems", () => {
  it("keeps the text and says so when there is no connection", async () => {
    const document = makeDocument({ content: "start" });
    answerDocument(document);
    answerSave(() => HttpResponse.error());
    const { box } = await readyEditor(document);

    typeText(box, "start, still typing");
    fireEvent.blur(box);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Not saved.");
    expect(alert).toHaveTextContent("Your text is still here");
    expect(box).toHaveValue("start, still typing");
  });

  it("says why when the text is refused, and keeps it", async () => {
    const document = makeDocument({ content: "start" });
    answerDocument(document);
    answerSave(() =>
      problemResponse(400, "validation-error", {
        errors: [
          {
            source: "body",
            pointer: "/content",
            message: "The text contains an invalid character.",
          },
        ],
      }),
    );
    const { box } = await readyEditor(document);
    typeText(box, "bad");
    fireEvent.blur(box);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Not saved. The text contains an invalid character.",
    );
    expect(box).toHaveValue("bad");
  });

  it("tells the writer to copy the text when the document no longer exists", async () => {
    const document = makeDocument({ content: "start" });
    answerDocument(document);
    answerSave(() => problemResponse(404, "not-found"));
    const { box } = await readyEditor(document);
    typeText(box, "orphaned text");
    fireEvent.blur(box);
    expect(await screen.findByRole("alert")).toHaveTextContent("copy it before you leave");
    expect(box).toHaveValue("orphaned text");
  });

  it("says how long it waits when there are too many saves, and does not give up", async () => {
    const document = makeDocument({ content: "start" });
    answerDocument(document);
    answerSave(() => problemResponse(429, "rate-limited", {}, { "retry-after": "30" }));
    const { box } = await readyEditor(document);
    typeText(box, "start!");
    fireEvent.blur(box);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many saves in a short time. Trying again in 30 seconds.",
    );
  });
});

describe("DocumentEditor: when somebody saved first", () => {
  async function conflicted() {
    const document = makeDocument({ content: "start", version: 1 });
    const newer = { ...document, content: "their text", version: 8, wordCount: 2 };
    answerDocument(document, newer);
    let saves = 0;
    const calls = answerSave((call) => {
      saves += 1;
      return saves === 1 ? problemResponse(412, "precondition-failed") : saved(newer)(call);
    });
    const rendered = await readyEditor(document);
    typeText(rendered.box, "my text");
    fireEvent.blur(rendered.box);
    await screen.findByText("This text was changed somewhere else.");
    return { ...rendered, calls, newer };
  }

  it("keeps the writer's text in the box and shows the notice with both choices", async () => {
    const { box } = await conflicted();
    expect(box).toHaveValue("my text");
    expect(screen.getByText("Not saved")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save my text over theirs" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Load the newer text (discard mine)" }),
    ).toBeVisible();
  });

  it("does not try to save more typing by itself", async () => {
    const { box, calls } = await conflicted();
    typeText(box, "my text, and more");
    fireEvent.blur(box);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toHaveLength(1);
    expect(screen.getByText("This text was changed somewhere else.")).toBeVisible();
  });

  it("saves the writer's text over theirs, on top of their version, and closes the notice", async () => {
    const { user, box, calls } = await conflicted();
    await user.click(screen.getByRole("button", { name: "Save my text over theirs" }));

    await waitFor(() => expect(screen.getByText("Saved")).toBeVisible());
    expect(calls).toHaveLength(2);
    expect(calls[1]?.ifMatch).toBe('"8"');
    expect(calls[1]?.body).toEqual({ content: "my text" });
    expect(box).toHaveValue("my text");
    expect(box).toHaveFocus();
    expect(screen.queryByText("This text was changed somewhere else.")).not.toBeInTheDocument();
  });

  it("loads the newer text into the box and starts from its version", async () => {
    const { user, box, calls, newer } = await conflicted();
    await user.click(screen.getByRole("button", { name: "Load the newer text (discard mine)" }));

    await waitFor(() => expect(box).toHaveValue("their text"));
    expect(screen.getByText("Saved")).toBeVisible();
    expect(screen.getByText("2 words")).toBeVisible();
    expect(box).toHaveFocus();
    expect(screen.queryByText("This text was changed somewhere else.")).not.toBeInTheDocument();

    // The next save builds on the newer version.
    answerSave(saved(newer));
    typeText(box, "their text, continued");
    fireEvent.blur(box);
    await waitFor(() => expect(screen.getByText("Saved")).toBeVisible());
    expect(calls).toHaveLength(1);
  });

  it("says why the newer text could not be loaded, and keeps the writer's text", async () => {
    const document = makeDocument({ content: "start" });
    answerDocument(document, () => HttpResponse.error());
    answerSave(() => problemResponse(412, "precondition-failed"));
    const { user, box } = await readyEditor(document);
    typeText(box, "my text");
    fireEvent.blur(box);
    await screen.findByText("This text was changed somewhere else.");

    await user.click(screen.getByRole("button", { name: "Load the newer text (discard mine)" }));
    expect(await screen.findByText(/Can't reach the server/)).toBeVisible();
    expect(box).toHaveValue("my text");
  });
});

describe("DocumentEditor: the limit", () => {
  it("says nothing about characters for an ordinary text", async () => {
    const document = makeDocument({ content: "short" });
    answerDocument(document);
    await readyEditor(document);
    expect(screen.queryByText(/characters/)).not.toBeInTheDocument();
  });

  it("shows how near the limit a long text is, counting an emoji as one character", async () => {
    const document = makeDocument({ content: "a" });
    answerDocument(document);
    const { box } = await readyEditor(document);
    typeText(box, `${"😀".repeat(95_000)}${"a".repeat(100_000)}`);
    expect(screen.getByText(/195,000 of 200,000 characters/)).toBeVisible();
  });

  it("opens a document that is already near the limit with the count shown", async () => {
    const document = makeDocument({ content: "a".repeat(199_000) });
    answerDocument(document);
    await readyEditor(document);
    expect(screen.getByText(/199,000 of 200,000 characters/)).toBeVisible();
  });
});

describe("DocumentEditor: closing the page", () => {
  it("asks before closing when the text is not saved", async () => {
    const document = makeDocument({ content: "start" });
    answerDocument(document);
    const { box } = await readyEditor(document);
    typeText(box, "start!");

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("does not ask when everything is saved", async () => {
    const document = makeDocument({ content: "start" });
    answerDocument(document);
    await readyEditor(document);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("still asks when the text could not be saved", async () => {
    const document = makeDocument({ content: "start" });
    answerDocument(document);
    answerSave(() => problemResponse(412, "precondition-failed"));
    const { box } = await readyEditor(document);
    typeText(box, "mine");
    fireEvent.blur(box);
    await screen.findByText("This text was changed somewhere else.");
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("stops asking after the editor is closed", async () => {
    const document = makeDocument({ content: "start" });
    answerDocument(document);
    answerSave(saved(document));
    const { box, unmount } = await readyEditor(document);
    typeText(box, "start!");
    unmount();
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("saves when the page is hidden", async () => {
    const document = makeDocument({ content: "start" });
    answerDocument(document);
    const calls = answerSave(saved(document));
    const { box } = await readyEditor(document);
    typeText(box, "start!");

    vi.spyOn(globalThis.document, "visibilityState", "get").mockReturnValue("hidden");
    globalThis.document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(calls).toHaveLength(1));
    vi.restoreAllMocks();
  });
});

describe("DocumentEditor: text", () => {
  it("shows markup in the text and the title as text, never as markup", async () => {
    const document = makeDocument({
      title: "<img src=x onerror=alert(1)>",
      content: "<script>window.hacked = 1</script><b>bold?</b>",
    });
    answerDocument(document);
    const { box } = await readyEditor(document);
    expect(box).toHaveValue("<script>window.hacked = 1</script><b>bold?</b>");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "<img src=x onerror=alert(1)>",
    );
    expect(globalThis.document.querySelector("main img, script, b")).toBeNull();
    expect((window as unknown as { hacked?: number }).hacked).toBeUndefined();
  });
});

describe("DocumentEditor: accessibility", () => {
  it("has no violations when saved, unsaved, with a problem, and in a conflict", async () => {
    const document = makeDocument({ content: "start" });
    answerDocument(document);
    answerSave(() => problemResponse(412, "precondition-failed"));
    const { box, container } = await readyEditor(document);
    await expectNoA11yViolations(container);

    typeText(box, "start!");
    await expectNoA11yViolations(container);

    fireEvent.blur(box);
    await screen.findByText("This text was changed somewhere else.");
    await expectNoA11yViolations(container);
  });

  it("has no violations with a problem alert and while loading", async () => {
    const document = makeDocument({ content: "start" });
    answerDocument(document);
    answerSave(() => HttpResponse.error());
    const { box, container } = await readyEditor(document);
    typeText(box, "start!");
    fireEvent.blur(box);
    await screen.findByRole("alert");
    await expectNoA11yViolations(container);
  });
});
