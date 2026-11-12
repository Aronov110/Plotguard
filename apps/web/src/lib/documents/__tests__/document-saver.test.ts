import { describe, expect, it, vi } from "vitest";
import { deferred } from "../../../test-support/session-harness.ts";
import { ApiError, NetworkError, ResponseShapeError } from "../../api/problem.ts";
import {
  createDocumentSaver,
  type DocumentSaverDeps,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  SAVE_DELAY_MS,
  type SavedDocument,
} from "../document-saver.ts";

interface FakeTimer {
  readonly callback: () => void;
  readonly ms: number;
  cancelled: boolean;
  fired: boolean;
}

function apiError(
  status: number,
  retryAfterSeconds?: number,
  issues: { pointer: string; message: string }[] = [],
) {
  return new ApiError({ status, code: undefined, detail: undefined, issues, retryAfterSeconds });
}

/** Lets every pending promise settle. The saver's own timers are fake, so this is a real tick. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(initial = { text: "start", version: 1, wordCount: 1 }) {
  const timers: FakeTimer[] = [];
  const save = vi.fn<DocumentSaverDeps["save"]>();
  const load = vi.fn<DocumentSaverDeps["load"]>();
  const reportError = vi.fn<DocumentSaverDeps["reportError"]>();
  const saver = createDocumentSaver(initial, {
    save,
    load,
    reportError,
    setTimer: (callback, ms) => {
      const timer: FakeTimer = { callback, ms, cancelled: false, fired: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  const live = () => timers.filter((timer) => !timer.cancelled && !timer.fired);
  /** Fires the one live timer, as time passing would, and lets the promises settle. */
  const fire = async () => {
    const [timer] = live();
    if (timer === undefined) throw new Error("There is no live timer to fire.");
    timer.fired = true;
    timer.callback();
    await settle();
  };
  const status = () => saver.getSnapshot().status.kind;
  const ok = (version: number, wordCount = 1): SavedDocument => ({ version, wordCount });
  return { saver, save, load, reportError, timers, live, fire, status, ok };
}

describe("document saver: the start", () => {
  it("starts saved, with the version and word count it was given, and no timers", () => {
    const { saver, live } = setup({ text: "a b", version: 5, wordCount: 2 });
    expect(saver.getSnapshot()).toEqual({
      status: { kind: "saved" },
      version: 5,
      wordCount: 2,
      characters: undefined,
    });
    expect(saver.hasUnsaved()).toBe(false);
    expect(live()).toEqual([]);
  });
});

describe("document saver: the wait before saving", () => {
  it("says unsaved at once, and saves only after the pause", async () => {
    const { saver, save, live, fire, status, ok } = setup();
    save.mockResolvedValue(ok(2));
    saver.change("start, more");

    expect(status()).toBe("unsaved");
    expect(saver.hasUnsaved()).toBe(true);
    expect(live()).toHaveLength(1);
    expect(live()[0]?.ms).toBe(SAVE_DELAY_MS);
    expect(save).not.toHaveBeenCalled();

    await fire();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("start, more", 1);
  });

  it("restarts the wait on every keystroke, so only the last one saves", async () => {
    const { saver, save, timers, live, fire, ok } = setup();
    save.mockResolvedValue(ok(2));
    saver.change("a");
    saver.change("ab");
    saver.change("abc");

    expect(timers).toHaveLength(3);
    expect(timers.filter((timer) => timer.cancelled)).toHaveLength(2);
    expect(live()).toHaveLength(1);
    await fire();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("abc", 1);
  });

  it("sends the newest text, not the text of the first keystroke", async () => {
    const { saver, save, fire, ok } = setup();
    save.mockResolvedValue(ok(2));
    saver.change("first");
    saver.change("second");
    await fire();
    expect(save.mock.calls[0]?.[0]).toBe("second");
  });

  it("says saved, with the new version and the server's word count, after a save", async () => {
    const { saver, save, fire, status, ok } = setup();
    save.mockResolvedValue(ok(2, 7));
    saver.change("changed");
    await fire();

    expect(status()).toBe("saved");
    expect(saver.getSnapshot()).toMatchObject({ version: 2, wordCount: 7 });
    expect(saver.hasUnsaved()).toBe(false);
  });

  it("says saving while the save runs", async () => {
    const { saver, save, fire, status, ok } = setup();
    const gate = deferred<SavedDocument>();
    save.mockReturnValue(gate.promise);
    saver.change("changed");
    await fire();

    expect(status()).toBe("saving");
    expect(saver.hasUnsaved()).toBe(true);
    gate.resolve(ok(2));
    await settle();
    expect(status()).toBe("saved");
  });

  it("starts each save on top of the version the last one returned", async () => {
    const { saver, save, fire, ok } = setup();
    save.mockResolvedValueOnce(ok(2)).mockResolvedValueOnce(ok(3)).mockResolvedValueOnce(ok(4));
    saver.change("one");
    await fire();
    saver.change("two");
    await fire();
    saver.change("three");
    await fire();

    expect(save.mock.calls.map((call) => call[1])).toEqual([1, 2, 3]);
    expect(saver.getSnapshot().version).toBe(4);
  });

  it("sends nothing when the text is typed back to what is saved", async () => {
    const { saver, save, live, status } = setup();
    saver.change("start!");
    expect(status()).toBe("unsaved");
    saver.change("start");

    expect(status()).toBe("saved");
    expect(live()).toEqual([]);
    expect(save).not.toHaveBeenCalled();
    expect(saver.hasUnsaved()).toBe(false);
  });

  it("tells its listeners about each change once, and not at all for a second identical status", async () => {
    const { saver, save, fire, ok } = setup();
    save.mockResolvedValue(ok(2));
    const listener = vi.fn();
    saver.subscribe(listener);

    saver.change("a");
    expect(listener).toHaveBeenCalledTimes(1);
    saver.change("ab");
    saver.change("abc");
    // Still "unsaved": nothing for a screen to redraw.
    expect(listener).toHaveBeenCalledTimes(1);

    await fire();
    // saving, then saved.
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("returns the same snapshot object until something changes", () => {
    const { saver } = setup();
    const first = saver.getSnapshot();
    expect(saver.getSnapshot()).toBe(first);
    saver.change("x");
    expect(saver.getSnapshot()).not.toBe(first);
  });

  it("stops telling a listener that unsubscribed", () => {
    const { saver } = setup();
    const listener = vi.fn();
    const unsubscribe = saver.subscribe(listener);
    unsubscribe();
    saver.change("x");
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("document saver: typing during a save", () => {
  it("saves the newer text next, on top of the new version, when the wait ended during the save", async () => {
    const { saver, save, live, fire, status, ok } = setup();
    const first = deferred<SavedDocument>();
    save.mockReturnValueOnce(first.promise).mockResolvedValueOnce(ok(3, 2));

    saver.change("one");
    await fire(); // the save of "one" is running
    saver.change("one two"); // typed during the save
    expect(live()).toHaveLength(1);
    await fire(); // the pause ended while the first save was still running

    expect(save).toHaveBeenCalledTimes(1);
    first.resolve(ok(2));
    await settle();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]).toEqual(["one two", 2]);
    expect(status()).toBe("saved");
    expect(saver.getSnapshot()).toMatchObject({ version: 3, wordCount: 2 });
  });

  it("says unsaved and lets the running wait do the next save when the pause has not ended", async () => {
    const { saver, save, live, fire, status, ok } = setup();
    const first = deferred<SavedDocument>();
    save.mockReturnValueOnce(first.promise).mockResolvedValueOnce(ok(3));

    saver.change("one");
    await fire();
    saver.change("one two"); // the wait for this keystroke is still running
    first.resolve(ok(2));
    await settle();

    expect(status()).toBe("unsaved");
    expect(save).toHaveBeenCalledTimes(1);
    expect(live()).toHaveLength(1);
    await fire();
    expect(save.mock.calls[1]).toEqual(["one two", 2]);
    expect(status()).toBe("saved");
  });

  it("never runs two saves at the same time", async () => {
    const { saver, save, fire, ok } = setup();
    const first = deferred<SavedDocument>();
    let running = 0;
    let most = 0;
    save.mockImplementation(async () => {
      running += 1;
      most = Math.max(most, running);
      try {
        return await first.promise;
      } finally {
        running -= 1;
      }
    });
    saver.change("a");
    await fire();
    saver.change("ab");
    await fire();
    saver.change("abc");
    await fire();
    expect(most).toBe(1);
    first.resolve(ok(2));
    await settle();
  });

  it("does not say saved when the writer typed back to the old text during a save", async () => {
    const { saver, save, fire, status, ok } = setup();
    const first = deferred<SavedDocument>();
    save.mockReturnValueOnce(first.promise).mockResolvedValue(ok(3));
    saver.change("changed");
    await fire();
    saver.change("start"); // back to the text the server had before this save
    first.resolve(ok(2));
    await settle();

    // The server now holds "changed"; the screen holds "start": the difference is still unsaved.
    expect(saver.hasUnsaved()).toBe(true);
    expect(["unsaved", "saving"]).toContain(status());
    await fire();
    expect(save.mock.calls.at(-1)?.[0]).toBe("start");
  });
});

describe("document saver: saving at once (flush)", () => {
  it("saves what is pending without waiting for the pause, and cancels the wait", async () => {
    const { saver, save, live, status, ok } = setup();
    save.mockResolvedValue(ok(2));
    saver.change("changed");
    await saver.flush();

    expect(save).toHaveBeenCalledWith("changed", 1);
    expect(status()).toBe("saved");
    expect(live()).toEqual([]);
  });

  it("does nothing when nothing changed", async () => {
    const { saver, save } = setup();
    await saver.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it("waits for a running save and then saves what was typed meanwhile", async () => {
    const { saver, save, fire, status, ok } = setup();
    const first = deferred<SavedDocument>();
    save.mockReturnValueOnce(first.promise).mockResolvedValueOnce(ok(3));
    saver.change("one");
    await fire();
    saver.change("one two");

    const flushed = saver.flush();
    first.resolve(ok(2));
    await flushed;

    expect(save.mock.calls).toEqual([
      ["one", 1],
      ["one two", 2],
    ]);
    expect(status()).toBe("saved");
  });

  it("does not spin when the save fails: it resolves and leaves the retry to the timer", async () => {
    const { saver, save, live, status } = setup();
    save.mockRejectedValue(new NetworkError());
    saver.change("changed");
    await saver.flush();

    expect(save).toHaveBeenCalledTimes(1);
    expect(status()).toBe("retrying");
    expect(live()).toHaveLength(1);
  });

  it("never rejects", async () => {
    const { saver, save } = setup();
    save.mockRejectedValue(new Error("boom"));
    saver.change("changed");
    await expect(saver.flush()).resolves.toBeUndefined();
  });

  it("tries again at once from the retrying state, without waiting for the timer", async () => {
    const { saver, save, live, status, ok } = setup();
    save.mockRejectedValueOnce(new NetworkError()).mockResolvedValueOnce(ok(2));
    saver.change("changed");
    await saver.flush();
    expect(status()).toBe("retrying");

    await saver.flush();
    expect(status()).toBe("saved");
    expect(live()).toEqual([]);
  });
});

describe("document saver: failing for a passing reason", () => {
  it("keeps the text, says why, and retries after 5 seconds", async () => {
    const { saver, save, live, fire, status, ok } = setup();
    save.mockRejectedValueOnce(new NetworkError()).mockResolvedValueOnce(ok(2));
    saver.change("changed");
    await fire();

    expect(status()).toBe("retrying");
    const snapshot = saver.getSnapshot();
    expect(snapshot.status).toMatchObject({ kind: "retrying" });
    expect((snapshot.status as { message: string }).message).toContain("Your text is still here");
    expect(saver.hasUnsaved()).toBe(true);
    expect(live()[0]?.ms).toBe(RETRY_BASE_MS);

    await fire();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]).toEqual(["changed", 1]);
    expect(status()).toBe("saved");
  });

  it("waits longer after every failure, up to a minute, and starts over after a success", async () => {
    const { saver, save, live, fire, ok } = setup();
    save.mockRejectedValue(new NetworkError());
    saver.change("changed");
    await fire();
    const waits: number[] = [live()[0]?.ms ?? 0];
    for (let i = 0; i < 6; i += 1) {
      await fire();
      waits.push(live()[0]?.ms ?? 0);
    }
    expect(waits).toEqual([5000, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000]);
    expect(Math.max(...waits)).toBe(RETRY_MAX_MS);

    save.mockResolvedValueOnce(ok(2));
    await fire();
    saver.change("changed again");
    save.mockRejectedValueOnce(new NetworkError());
    await fire();
    expect(live()[0]?.ms).toBe(RETRY_BASE_MS);
  });

  it("waits as long as the server says after a 429", async () => {
    const { saver, save, live, fire, status } = setup();
    save.mockRejectedValue(apiError(429, 30));
    saver.change("changed");
    await fire();
    expect(status()).toBe("retrying");
    expect(live()[0]?.ms).toBe(30_000);
  });

  it("never waits less than a second, whatever the server says", async () => {
    const { saver, save, live, fire } = setup();
    save.mockRejectedValue(apiError(429, 0));
    saver.change("changed");
    await fire();
    expect(live()[0]?.ms).toBe(1000);
  });

  it.each([502, 503, 504, 500, 401])("retries after a %d", async (status) => {
    const { saver, save, live, fire } = setup();
    save.mockRejectedValue(apiError(status));
    saver.change("changed");
    await fire();
    expect(saver.getSnapshot().status.kind).toBe("retrying");
    expect(live()).toHaveLength(1);
  });

  it("reports an unexpected failure, and still keeps the text and retries", async () => {
    const { saver, save, live, fire, status, reportError } = setup();
    const odd = new ResponseShapeError("not what the API says");
    save.mockRejectedValue(odd);
    saver.change("changed");
    await fire();
    expect(reportError).toHaveBeenCalledWith(odd);
    expect(status()).toBe("retrying");
    expect(live()).toHaveLength(1);
  });

  it("does not report an expected failure", async () => {
    const { saver, save, fire, reportError } = setup();
    save.mockRejectedValue(new NetworkError());
    saver.change("changed");
    await fire();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("replaces the retry with the normal wait when the writer types again", async () => {
    const { saver, save, live, fire, status, ok } = setup();
    save.mockRejectedValueOnce(new NetworkError()).mockResolvedValueOnce(ok(2));
    saver.change("changed");
    await fire();
    expect(live()[0]?.ms).toBe(RETRY_BASE_MS);

    saver.change("changed more");
    expect(status()).toBe("unsaved");
    expect(live()).toHaveLength(1);
    expect(live()[0]?.ms).toBe(SAVE_DELAY_MS);
    await fire();
    expect(save.mock.calls[1]).toEqual(["changed more", 1]);
  });

  it("never runs a retry on top of a save that is already running", async () => {
    const { saver, save, live, fire, ok } = setup();
    const gate = deferred<SavedDocument>();
    save.mockRejectedValueOnce(new NetworkError()).mockReturnValueOnce(gate.promise);
    saver.change("changed");
    await fire(); // fails, retry scheduled
    await fire(); // the retry starts and hangs
    saver.change("changed again");
    await fire(); // the pause ends during the retry
    expect(save).toHaveBeenCalledTimes(2);
    gate.resolve(ok(2));
    save.mockResolvedValue(ok(3));
    await settle();
    expect(save).toHaveBeenCalledTimes(3);
    expect(live()).toEqual([]);
  });
});

describe("document saver: somebody saved first (412)", () => {
  async function conflicted() {
    const context = setup();
    context.save.mockRejectedValueOnce(apiError(412));
    context.saver.change("my text");
    await context.fire();
    return context;
  }

  it("stops, says conflict, and keeps the text and the unsaved mark", async () => {
    const { saver, status, live } = await conflicted();
    expect(status()).toBe("conflict");
    expect(saver.hasUnsaved()).toBe(true);
    expect(live()).toEqual([]);
  });

  it("does not save more typing by itself", async () => {
    const { saver, save, live, status } = await conflicted();
    saver.change("my text, and more");
    expect(status()).toBe("conflict");
    expect(live()).toEqual([]);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("does not save on flush either", async () => {
    const { saver, save } = await conflicted();
    await saver.flush();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("saves the writer's text over the server's when asked: it reads the newer version first", async () => {
    const { saver, save, load, status, ok } = await conflicted();
    load.mockResolvedValue({ version: 9 });
    save.mockResolvedValueOnce(ok(10, 2));
    await saver.overwrite();

    expect(load).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith("my text", 9);
    expect(status()).toBe("saved");
    expect(saver.getSnapshot()).toMatchObject({ version: 10, wordCount: 2 });
    expect(saver.hasUnsaved()).toBe(false);
  });

  it("sends the text even when it equals what was last saved", async () => {
    const { saver, save, load, status, ok } = setup();
    save.mockRejectedValueOnce(apiError(412));
    saver.change("changed");
    await saver.flush();
    expect(status()).toBe("conflict");

    // Typed back to the text the document had when it was opened: it equals what was last saved,
    // but the server holds somebody else's newer text, so "save mine over theirs" must still send it.
    saver.change("start");
    load.mockResolvedValue({ version: 4 });
    save.mockResolvedValueOnce(ok(5));
    await saver.overwrite();

    expect(save).toHaveBeenLastCalledWith("start", 4);
    expect(status()).toBe("saved");
  });

  it("does nothing when there is no conflict", async () => {
    const { saver, save, load } = setup();
    await saver.overwrite();
    expect(load).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("says gone when the document vanished while reading the newer version", async () => {
    const { saver, load, status } = await conflicted();
    load.mockRejectedValue(apiError(404));
    await saver.overwrite();
    expect(status()).toBe("gone");
  });

  it("can conflict again if somebody saved again meanwhile", async () => {
    const { saver, save, load, status } = await conflicted();
    load.mockResolvedValue({ version: 9 });
    save.mockRejectedValueOnce(apiError(412));
    await saver.overwrite();
    expect(status()).toBe("conflict");
  });

  it("takes over the newer text, version and word count on reset, and is saved", async () => {
    const { saver, save, live, status } = await conflicted();
    saver.reset("their text", 9, 2);

    expect(status()).toBe("saved");
    expect(saver.getSnapshot()).toMatchObject({ version: 9, wordCount: 2 });
    expect(saver.hasUnsaved()).toBe(false);
    expect(live()).toEqual([]);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("saves again from the new version after a reset", async () => {
    const { saver, save, fire, ok } = await conflicted();
    saver.reset("their text", 9, 2);
    save.mockResolvedValueOnce(ok(10));
    saver.change("their text, continued");
    await fire();
    expect(save).toHaveBeenLastCalledWith("their text, continued", 9);
  });
});

describe("document saver: the document is gone (404)", () => {
  it("stops, says gone, and keeps the text and the unsaved mark", async () => {
    const { saver, save, live, fire, status } = setup();
    save.mockRejectedValue(apiError(404));
    saver.change("changed");
    await fire();

    expect(status()).toBe("gone");
    expect(saver.hasUnsaved()).toBe(true);
    expect(live()).toEqual([]);
    saver.change("changed more");
    expect(status()).toBe("gone");
    expect(live()).toEqual([]);
  });
});

describe("document saver: text that cannot be saved (400)", () => {
  it("says why and stops until the text changes", async () => {
    const { saver, save, live, fire, status } = setup();
    save.mockRejectedValue(
      apiError(400, undefined, [
        { pointer: "/content", message: "The text contains an invalid character." },
      ]),
    );
    saver.change("bad\u0000text");
    await fire();

    expect(status()).toBe("invalid");
    expect(saver.getSnapshot().status).toMatchObject({
      message: "The text contains an invalid character.",
    });
    expect(live()).toEqual([]);
    expect(saver.hasUnsaved()).toBe(true);
  });

  it("does not try again on flush while the text is the same", async () => {
    const { saver, save, fire } = setup();
    save.mockRejectedValue(apiError(400));
    saver.change("bad");
    await fire();
    await saver.flush();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("tries again after the text changes, and recovers when it is fixed", async () => {
    const { saver, save, fire, status, ok } = setup();
    save.mockRejectedValueOnce(apiError(400)).mockResolvedValueOnce(ok(2));
    saver.change("bad");
    await fire();
    expect(status()).toBe("invalid");

    saver.change("good");
    expect(status()).toBe("unsaved");
    await fire();
    expect(save).toHaveBeenLastCalledWith("good", 1);
    expect(status()).toBe("saved");
  });

  it("says invalid for a body that is too big (413)", async () => {
    const { saver, save, fire, status } = setup();
    save.mockRejectedValue(apiError(413));
    saver.change("huge");
    await fire();
    expect(status()).toBe("invalid");
  });
});

describe("document saver: how near the limit is", () => {
  it("counts characters only near the limit, as the API counts them", () => {
    const { saver } = setup();
    saver.change("a".repeat(189_999));
    expect(saver.getSnapshot().characters).toBeUndefined();
    saver.change("a".repeat(190_000));
    expect(saver.getSnapshot().characters).toBe(190_000);
    saver.change("😀".repeat(100_000));
    expect(saver.getSnapshot().characters).toBe(100_000);
  });

  it("tells its listeners when the count appears, even if the status did not change", () => {
    const { saver } = setup();
    saver.change("a");
    const listener = vi.fn();
    saver.subscribe(listener);
    saver.change("a".repeat(190_000));
    expect(listener).toHaveBeenCalled();
    expect(saver.getSnapshot().characters).toBe(190_000);
  });

  it("starts with the count when the document is already near the limit", () => {
    const { saver } = setup({ text: "a".repeat(195_000), version: 1, wordCount: 1 });
    expect(saver.getSnapshot().characters).toBe(195_000);
  });
});

describe("document saver: leaving", () => {
  it("saves what is pending, then stops for good", async () => {
    const { saver, save, live, ok } = setup();
    save.mockResolvedValue(ok(2));
    saver.change("changed");
    await saver.leave();

    expect(save).toHaveBeenCalledWith("changed", 1);
    expect(live()).toEqual([]);
    saver.change("changed after leaving");
    expect(live()).toEqual([]);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("leaves quietly when nothing changed", async () => {
    const { saver, save } = setup();
    await saver.leave();
    expect(save).not.toHaveBeenCalled();
  });

  it("cancels the retry of a save that failed on the way out", async () => {
    const { saver, save, live } = setup();
    save.mockRejectedValue(new NetworkError());
    saver.change("changed");
    await saver.leave();
    expect(live()).toEqual([]);
  });

  it("does not wait for a conflict: there is nothing it could save", async () => {
    const { saver, save, fire } = setup();
    save.mockRejectedValueOnce(apiError(412));
    saver.change("changed");
    await fire();
    await saver.leave();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("stops telling its listeners after leaving", async () => {
    const { saver, save, ok } = setup();
    save.mockResolvedValue(ok(2));
    saver.change("changed");
    await saver.leave();
    const listener = vi.fn();
    saver.subscribe(listener);
    saver.change("again");
    expect(listener).not.toHaveBeenCalled();
  });

  it("can be called twice", async () => {
    const { saver, save, ok } = setup();
    save.mockResolvedValue(ok(2));
    saver.change("changed");
    await saver.leave();
    await saver.leave();
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("document saver: a change other than the text (exclusive)", () => {
  it("calls the change with the version the saver has, and keeps the version and words it returns", async () => {
    const { saver, ok } = setup({ text: "start", version: 4, wordCount: 1 });
    const change = vi.fn().mockResolvedValue(ok(5, 1));

    expect(await saver.exclusive(change)).toEqual({ ok: true });

    expect(change).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledWith(4);
    expect(saver.getSnapshot()).toMatchObject({ version: 5, wordCount: 1 });
  });

  it("saves the next text on top of the version the change returned, so the writer never conflicts with themselves", async () => {
    const { saver, save, fire, status, ok } = setup();
    save.mockResolvedValue(ok(3));

    await saver.exclusive(() => Promise.resolve(ok(2)));
    saver.change("start, more");
    await fire();

    expect(save).toHaveBeenCalledWith("start, more", 2);
    expect(status()).toBe("saved");
  });

  it("saves the pending text first, then runs the change on the version that save returned", async () => {
    const { saver, save, ok } = setup();
    const order: string[] = [];
    save.mockImplementation(() => {
      order.push("save");
      return Promise.resolve(ok(2));
    });
    const change = vi.fn((version: number) => {
      order.push(`change on ${version}`);
      return Promise.resolve(ok(3));
    });

    saver.change("start, more");
    await saver.exclusive(change);

    expect(order).toEqual(["save", "change on 2"]);
    expect(saver.getSnapshot().version).toBe(3);
  });

  it("waits for a save that is already running before it takes its turn", async () => {
    const { saver, save, fire, ok } = setup();
    const running = deferred<SavedDocument>();
    save.mockReturnValueOnce(running.promise);
    const change = vi.fn().mockResolvedValue(ok(3));

    saver.change("start, more");
    await fire(); // the save is running
    const result = saver.exclusive(change);
    await settle();
    expect(change).not.toHaveBeenCalled();

    running.resolve(ok(2));
    expect(await result).toEqual({ ok: true });
    expect(change).toHaveBeenCalledWith(2);
  });

  it("says saving while the change runs, then saved", async () => {
    const { saver, status, ok } = setup();
    const gate = deferred<SavedDocument>();

    const result = saver.exclusive(() => gate.promise);
    await settle();
    expect(status()).toBe("saving");

    gate.resolve(ok(2));
    await result;
    expect(status()).toBe("saved");
  });

  it("saves text typed during the change afterwards, on the new version, and says unsaved meanwhile", async () => {
    const { saver, save, live, fire, status, ok } = setup();
    const gate = deferred<SavedDocument>();
    save.mockResolvedValue(ok(3, 2));

    const result = saver.exclusive(() => gate.promise);
    await settle();
    saver.change("start, more"); // typed during the change
    expect(live()).toHaveLength(1);
    gate.resolve(ok(2));
    await result;

    expect(status()).toBe("unsaved");
    expect(save).not.toHaveBeenCalled();
    await fire();
    expect(save).toHaveBeenCalledWith("start, more", 2);
    expect(status()).toBe("saved");
  });

  it("saves at once, on the new version, when the pause ended during the change", async () => {
    const { saver, save, fire, status, ok } = setup();
    const gate = deferred<SavedDocument>();
    save.mockResolvedValue(ok(3, 2));

    const result = saver.exclusive(() => gate.promise);
    await settle();
    saver.change("start, more");
    await fire(); // the pause ended while the change was still running
    expect(save).not.toHaveBeenCalled();

    gate.resolve(ok(2));
    await result;
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("start, more", 2);
    expect(status()).toBe("saved");
  });

  it("takes turns even when two changes start in the same moment", async () => {
    const { saver, ok } = setup();
    const gate = deferred<SavedDocument>();
    const first = vi.fn(() => gate.promise);
    const second = vi.fn().mockResolvedValue(ok(3));

    const one = saver.exclusive(first);
    const two = saver.exclusive(second); // no wait in between
    await settle();
    expect(first).toHaveBeenCalledWith(1);
    expect(second).not.toHaveBeenCalled();

    gate.resolve(ok(2));
    await Promise.all([one, two]);
    expect(second).toHaveBeenCalledWith(2);
    expect(saver.getSnapshot().version).toBe(3);
  });

  it("takes turns: a second change waits for the first and starts from its version", async () => {
    const { saver, ok } = setup();
    const gate = deferred<SavedDocument>();
    const first = vi.fn(() => gate.promise);
    const second = vi.fn().mockResolvedValue(ok(3));

    const one = saver.exclusive(first);
    await settle();
    const two = saver.exclusive(second);
    await settle();
    expect(second).not.toHaveBeenCalled();

    gate.resolve(ok(2));
    await Promise.all([one, two]);
    expect(second).toHaveBeenCalledWith(2);
    expect(saver.getSnapshot().version).toBe(3);
  });

  describe("when the server says no", () => {
    it("a 412 is a conflict: the status says so, and nothing is saved by itself afterwards", async () => {
      const { saver, save, live, status } = setup();
      const result = await saver.exclusive(() => Promise.reject(apiError(412)));

      expect(result).toEqual({ ok: false, reason: "conflict" });
      expect(status()).toBe("conflict");
      saver.change("start, more");
      expect(live()).toEqual([]);
      expect(save).not.toHaveBeenCalled();
    });

    it("a 404 means the document is gone", async () => {
      const { saver, status } = setup();
      const result = await saver.exclusive(() => Promise.reject(apiError(404)));
      expect(result).toEqual({ ok: false, reason: "gone" });
      expect(status()).toBe("gone");
    });

    it("a refused title (400) comes back as a failure and does not make the text invalid", async () => {
      const { saver, save, fire, status, ok } = setup();
      const refused = apiError(400, undefined, [{ pointer: "/title", message: "Enter a title." }]);

      const result = await saver.exclusive(() => Promise.reject(refused));

      expect(result).toEqual({ ok: false, reason: "failed", error: refused });
      expect(status()).toBe("saved");
      save.mockResolvedValue(ok(2));
      saver.change("start, more");
      await fire();
      expect(save).toHaveBeenCalledWith("start, more", 1);
    });

    it("no connection comes back as a failure, with no retry of its own and the version unchanged", async () => {
      const { saver, live, status } = setup();
      const lost = new NetworkError();

      const result = await saver.exclusive(() => Promise.reject(lost));

      expect(result).toEqual({ ok: false, reason: "failed", error: lost });
      expect(status()).toBe("saved");
      expect(live()).toEqual([]);
      expect(saver.getSnapshot().version).toBe(1);
    });

    it("a too-many-requests answer (429) is a failure too, and the text status stays", async () => {
      const { saver, status } = setup();
      const result = await saver.exclusive(() => Promise.reject(apiError(429, 3)));
      expect(result).toMatchObject({ ok: false, reason: "failed" });
      expect(status()).toBe("saved");
    });

    it("an error nobody expected comes back as it is, and is left for the caller to report", async () => {
      const { saver, reportError } = setup();
      const bug = new ResponseShapeError("odd");
      const result = await saver.exclusive(() => Promise.reject(bug));
      expect(result).toEqual({ ok: false, reason: "failed", error: bug });
      expect(reportError).not.toHaveBeenCalled();
    });

    it("keeps the pending text after a failure, and saves it when the pause ends", async () => {
      const { saver, save, fire, status, ok } = setup();
      const gate = deferred<SavedDocument>();
      save.mockResolvedValue(ok(2, 2));

      const result = saver.exclusive(() => gate.promise);
      await settle();
      saver.change("start, more");
      gate.reject(new NetworkError());
      await result;

      expect(status()).toBe("unsaved");
      await fire();
      expect(save).toHaveBeenCalledWith("start, more", 1);
    });
  });

  describe("when it must not run", () => {
    it("does nothing during a conflict, and says why", async () => {
      const { saver, save, fire } = setup();
      save.mockRejectedValueOnce(apiError(412));
      saver.change("changed");
      await fire();
      const change = vi.fn();

      expect(await saver.exclusive(change)).toEqual({ ok: false, reason: "conflict" });
      expect(change).not.toHaveBeenCalled();
    });

    it("does nothing when the document is gone", async () => {
      const { saver, save, fire } = setup();
      save.mockRejectedValueOnce(apiError(404));
      saver.change("changed");
      await fire();
      const change = vi.fn();

      expect(await saver.exclusive(change)).toEqual({ ok: false, reason: "gone" });
      expect(change).not.toHaveBeenCalled();
    });

    it("does nothing when the pending text meets a conflict while it is saved first", async () => {
      const { saver, save } = setup();
      save.mockRejectedValueOnce(apiError(412));
      saver.change("changed");
      const change = vi.fn();

      expect(await saver.exclusive(change)).toEqual({ ok: false, reason: "conflict" });
      expect(change).not.toHaveBeenCalled();
    });

    it("does nothing after the writer has left", async () => {
      const { saver } = setup();
      await saver.leave();
      const change = vi.fn();
      expect(await saver.exclusive(change)).toEqual({ ok: false, reason: "left" });
      expect(change).not.toHaveBeenCalled();
    });

    it("does nothing after the document was abandoned", async () => {
      const { saver } = setup();
      saver.abandon();
      const change = vi.fn();
      expect(await saver.exclusive(change)).toEqual({ ok: false, reason: "left" });
      expect(change).not.toHaveBeenCalled();
    });
  });

  it("runs while the text is refused as invalid: the text is not part of the change", async () => {
    const { saver, save, fire, status, ok } = setup();
    save.mockRejectedValueOnce(apiError(400, undefined, [{ pointer: "/content", message: "No." }]));
    saver.change("bad");
    await fire();
    expect(status()).toBe("invalid");

    const change = vi.fn().mockResolvedValue(ok(2));
    expect(await saver.exclusive(change)).toEqual({ ok: true });
    expect(change).toHaveBeenCalledWith(1);
  });

  it("puts the retry message back when the text could not be saved before the change", async () => {
    const { saver, save, status } = setup();
    save.mockRejectedValue(new NetworkError());
    saver.change("changed");
    const change = vi.fn().mockResolvedValue({ version: 2, wordCount: 1 });

    expect(await saver.exclusive(change)).toEqual({ ok: true });

    expect(change).toHaveBeenCalledWith(1);
    expect(status()).toBe("retrying");
  });

  it("tells its listeners about the new version", async () => {
    const { saver, ok } = setup();
    const listener = vi.fn();
    saver.subscribe(listener);
    await saver.exclusive(() => Promise.resolve(ok(2, 7)));
    expect(listener).toHaveBeenCalled();
    expect(saver.getSnapshot()).toMatchObject({ version: 2, wordCount: 7 });
  });
});

describe("document saver: abandoning", () => {
  it("stops the wait and saves nothing, however much is unsaved", async () => {
    const { saver, save, live } = setup();
    saver.change("changed");
    saver.abandon();
    expect(live()).toEqual([]);
    await saver.leave();
    expect(save).not.toHaveBeenCalled();
  });

  it("ignores text typed afterwards, and stops telling its listeners", () => {
    const { saver, live } = setup();
    const listener = vi.fn();
    saver.subscribe(listener);
    saver.abandon();
    saver.change("typed after");
    expect(live()).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("cancels the retry of a failed save", async () => {
    const { saver, save, fire, live } = setup();
    save.mockRejectedValue(new NetworkError());
    saver.change("changed");
    await fire();
    expect(live()).toHaveLength(1);
    saver.abandon();
    expect(live()).toEqual([]);
  });

  it("saves nothing when something asks it to save at once afterwards (a blur while the editor goes away)", async () => {
    const { saver, save } = setup();
    saver.change("changed");
    saver.abandon();
    await saver.flush();
    expect(save).not.toHaveBeenCalled();
  });
});
