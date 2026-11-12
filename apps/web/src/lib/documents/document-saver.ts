import { ApiError, NetworkError } from "../api/problem.ts";
import { charactersNearLimit } from "./count-text.ts";
import { classifySaveError } from "./document-feedback.ts";

/** How long after the last keystroke the text is saved. */
export const SAVE_DELAY_MS = 2000;
/** The first wait after a save failed for a passing reason; it doubles up to the maximum. */
export const RETRY_BASE_MS = 5000;
export const RETRY_MAX_MS = 60_000;
/** A safety stop for `flush`: it can never loop for ever, whatever the server answers. */
const MAX_FLUSH_ROUNDS = 50;

/** Where the text stands compared with what the server has. */
export type SaveStatus =
  /** The server has what is on the screen. */
  | { readonly kind: "saved" }
  /** Changed since the last save; waiting for the writer to pause. */
  | { readonly kind: "unsaved" }
  | { readonly kind: "saving" }
  /** The last save failed for a passing reason; it is tried again by itself. */
  | { readonly kind: "retrying"; readonly message: string }
  /** The text cannot be saved as it is. Nothing is tried until the text changes. */
  | { readonly kind: "invalid"; readonly message: string }
  /** Somebody saved a newer version first. Nothing is tried until the writer decides. */
  | { readonly kind: "conflict" }
  /** The document no longer exists. */
  | { readonly kind: "gone" };

export interface SaverSnapshot {
  readonly status: SaveStatus;
  /** The version the server has, which the next save must start from. */
  readonly version: number;
  /** The server's word count of the last saved text. */
  readonly wordCount: number;
  /** The number of characters, only when the text is near the limit; otherwise `undefined`. */
  readonly characters: number | undefined;
}

/** What the server says about a document it has just saved. */
export interface SavedDocument {
  readonly version: number;
  readonly wordCount: number;
}

/**
 * What {@link DocumentSaver.exclusive} gives back. A change that did not run, or failed, never
 * touches the text status except where the server's answer is about the document itself.
 */
export type ExclusiveResult =
  | { readonly ok: true }
  /** It did not run: the document is in conflict, is gone, or the writer has left it. */
  | { readonly ok: false; readonly reason: "conflict" | "gone" | "left" }
  /** The server refused it, or could not be reached. The text status is as it was. */
  | { readonly ok: false; readonly reason: "failed"; readonly error: unknown };

export interface DocumentSaverDeps {
  /** Saves `text` on top of `version`. Throws `ApiError` or `NetworkError` when it fails. */
  readonly save: (text: string, version: number) => Promise<SavedDocument>;
  /** Reads the version the server has now, for "save my text over theirs". */
  readonly load: () => Promise<{ readonly version: number }>;
  /** Runs `callback` after `ms` milliseconds. Returns a function that cancels it. */
  readonly setTimer: (callback: () => void, ms: number) => () => void;
  /** Receives failures nobody expected (a bug, an answer in the wrong shape). */
  readonly reportError: (error: unknown) => void;
}

export interface DocumentSaver {
  /** The current state. The same object is returned until something really changes. */
  getSnapshot(): SaverSnapshot;
  /** Calls `listener` after every change. Returns a function that stops the calls. */
  subscribe(listener: () => void): () => void;
  /** The text on the screen changed. Starts (or restarts) the wait before saving. */
  change(text: string): void;
  /**
   * Saves what is pending now, without waiting for a pause, and resolves when that is done or has
   * failed. Never rejects. Does nothing while the status is conflict, gone or invalid.
   */
  flush(): Promise<void>;
  /**
   * After a conflict: reads the server's version and saves the text on the screen over it. Does
   * nothing when there is no conflict.
   */
  overwrite(): Promise<void>;
  /** Takes over a text and version that were just read from the server (after a conflict). */
  reset(text: string, version: number, wordCount: number): void;
  /** True when the screen holds text the server does not have, or a save is on its way. */
  hasUnsaved(): boolean;
  /** Saves what is pending, then stops for good. Call it when the writer leaves the document. */
  leave(): Promise<void>;
  /**
   * Runs a change to the document other than its text (a new title, a new place) so that it takes
   * turns with the text saves. It saves the pending text first, waits for any save that is running,
   * then calls `change` with the version the server has and keeps the version the answer returns, so
   * the next text save does not conflict with the writer's own change.
   *
   * A 412 or 404 from `change` is about the document itself and sets the status to conflict or
   * gone. Any other failure (a refused title, no connection) comes back as `failed` and leaves the
   * status of the text alone: the text is fine. Never rejects.
   */
  exclusive(change: (version: number) => Promise<SavedDocument>): Promise<ExclusiveResult>;
  /**
   * Stops for good without saving anything. For a document that has just been deleted: there is
   * nothing left to save into.
   */
  abandon(): void;
}

function sameStatus(a: SaveStatus, b: SaveStatus): boolean {
  if (a.kind !== b.kind) return false;
  if ("message" in a && "message" in b) return a.message === b.message;
  return true;
}

/**
 * The autosave of one document, with no React in it so that its timing rules can be tested with
 * timers that tests control. The rules:
 *
 * - The text is saved {@link SAVE_DELAY_MS} after the last change.
 * - One save runs at a time. Text typed during a save is saved next, on top of the version the
 *   first save returned, so a writer never conflicts with themselves.
 * - A failure for a passing reason (no connection, too many requests, a busy server) is retried
 *   after 5, 10, 20, 40 and then every 60 seconds (or as long as the server says). The text on the
 *   screen is never touched.
 * - A 412 stops everything: somebody else saved a newer version, and only the writer decides what
 *   happens to the text on the screen.
 */
export function createDocumentSaver(
  initial: SavedDocument & { readonly text: string },
  deps: DocumentSaverDeps,
): DocumentSaver {
  let latest = initial.text;
  let savedText = initial.text;
  let version = initial.version;
  let wordCount = initial.wordCount;
  let characters = charactersNearLimit(initial.text);
  let status: SaveStatus = { kind: "saved" };
  let failures = 0;
  let cancelDebounce: (() => void) | undefined;
  let cancelRetry: (() => void) | undefined;
  // `busy` is true from the moment a save starts until its loop ends, with no gap; `running` is the
  // promise of that loop, for callers that want to wait for it.
  let busy = false;
  let running: Promise<void> = Promise.resolve();
  // Set when the wait ended while a save was running: the next round starts at once.
  let pendingAttempt = false;
  // Set by `overwrite`: send the text even if it equals what was last saved.
  let forceNext = false;
  let left = false;

  const listeners = new Set<() => void>();
  let snapshot: SaverSnapshot = { status, version, wordCount, characters };

  function publish(): void {
    snapshot = { status, version, wordCount, characters };
    for (const listener of [...listeners]) listener();
  }

  /** Changes the status and tells the listeners, unless it is the same as before. */
  function setStatus(next: SaveStatus): boolean {
    if (sameStatus(status, next)) return false;
    status = next;
    publish();
    return true;
  }

  /** Why nothing can be changed in this document, or `undefined` when something can. */
  function refusal(): "conflict" | "gone" | undefined {
    return status.kind === "conflict" || status.kind === "gone" ? status.kind : undefined;
  }

  function blocked(): boolean {
    return status.kind === "conflict" || status.kind === "gone" || status.kind === "invalid";
  }

  function stopTimers(): void {
    cancelDebounce?.();
    cancelDebounce = undefined;
    cancelRetry?.();
    cancelRetry = undefined;
  }

  function handleFailure(error: unknown): void {
    if (!(error instanceof ApiError) && !(error instanceof NetworkError)) deps.reportError(error);
    const problem = classifySaveError(error);
    switch (problem.kind) {
      case "conflict":
        setStatus({ kind: "conflict" });
        return;
      case "gone":
        setStatus({ kind: "gone" });
        return;
      case "invalid":
        setStatus({ kind: "invalid", message: problem.message });
        return;
      case "retry": {
        failures += 1;
        setStatus({ kind: "retrying", message: problem.message });
        const wait =
          problem.waitSeconds === undefined
            ? Math.min(RETRY_BASE_MS * 2 ** (failures - 1), RETRY_MAX_MS)
            : Math.max(1000, problem.waitSeconds * 1000);
        cancelRetry?.();
        cancelRetry = deps.setTimer(() => {
          cancelRetry = undefined;
          void attempt();
        }, wait);
      }
    }
  }

  async function run(): Promise<void> {
    try {
      for (;;) {
        pendingAttempt = false;
        if (latest === savedText && !forceNext) {
          setStatus({ kind: "saved" });
          return;
        }
        forceNext = false;

        const sent = latest;
        setStatus({ kind: "saving" });
        let result: SavedDocument;
        try {
          result = await deps.save(sent, version);
        } catch (error) {
          handleFailure(error);
          return;
        }

        savedText = sent;
        version = result.version;
        wordCount = result.wordCount;
        failures = 0;
        if (latest === savedText) {
          status = { kind: "saved" };
          publish();
          return;
        }
        // The text changed while this save was running.
        if (pendingAttempt) {
          // The wait for a pause ended meanwhile: save again at once, on top of the new version.
          publish();
          continue;
        }
        // The wait for a pause is still running and will save it.
        status = { kind: "unsaved" };
        publish();
        return;
      }
    } finally {
      busy = false;
    }
  }

  function attempt(): Promise<void> {
    if (busy) {
      pendingAttempt = true;
      return running;
    }
    busy = true;
    running = run();
    return running;
  }

  function onDebounce(): void {
    cancelDebounce = undefined;
    void attempt();
  }

  async function flush(): Promise<void> {
    // After `abandon` there is nothing to save into. (`leave` flushes before it sets `left`.)
    if (left) return;
    stopTimers();
    if (blocked()) return;
    for (let round = 0; round < MAX_FLUSH_ROUNDS; round += 1) {
      if (busy) await running;
      else if (latest !== savedText) await attempt();
      else return;
      if (blocked() || status.kind === "retrying") return;
      if (!busy && latest === savedText) return;
    }
  }

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    change(text) {
      if (left) return;
      latest = text;
      const nextCharacters = charactersNearLimit(text);
      const charactersChanged = nextCharacters !== characters;
      characters = nextCharacters;

      // After a conflict or a vanished document nothing is saved by itself; the text is only kept.
      if (status.kind === "conflict" || status.kind === "gone") {
        if (charactersChanged) publish();
        return;
      }

      stopTimers();
      let statusChanged = false;
      if (text === savedText && !busy) {
        failures = 0;
        statusChanged = setStatus({ kind: "saved" });
      } else {
        if (!busy) statusChanged = setStatus({ kind: "unsaved" });
        cancelDebounce = deps.setTimer(onDebounce, SAVE_DELAY_MS);
      }
      if (charactersChanged && !statusChanged) publish();
    },

    flush,

    async overwrite() {
      if (status.kind !== "conflict") return;
      setStatus({ kind: "saving" });
      try {
        const server = await deps.load();
        version = server.version;
      } catch (error) {
        handleFailure(error);
        return;
      }
      forceNext = true;
      await attempt();
    },

    reset(text, newVersion, newWordCount) {
      stopTimers();
      latest = text;
      savedText = text;
      version = newVersion;
      wordCount = newWordCount;
      characters = charactersNearLimit(text);
      failures = 0;
      pendingAttempt = false;
      forceNext = false;
      status = { kind: "saved" };
      publish();
    },

    hasUnsaved: () => latest !== savedText || busy,

    async leave() {
      if (left) return;
      await flush();
      left = true;
      stopTimers();
      listeners.clear();
    },

    async exclusive(change) {
      if (left) return { ok: false, reason: "left" };
      const first = refusal();
      if (first !== undefined) return { ok: false, reason: first };
      await flush();
      // Another save (or another change started in the same moment) may be running now. Once the loop
      // ends, the check and the lock (`busy = true`) happen in one step, so nothing slips in between.
      while (busy) await running;
      if (left) return { ok: false, reason: "left" };
      const second = refusal();
      if (second !== undefined) return { ok: false, reason: second };

      const before = status;
      busy = true;
      const outcome: { value: ExclusiveResult } = { value: { ok: true } };
      const job = (async (): Promise<void> => {
        try {
          setStatus({ kind: "saving" });
          const answer = await change(version);
          version = answer.version;
          wordCount = answer.wordCount;
        } catch (error) {
          const problem = error instanceof ApiError ? classifySaveError(error) : undefined;
          if (problem?.kind === "conflict" || problem?.kind === "gone") {
            outcome.value = { ok: false, reason: problem.kind };
          } else {
            outcome.value = { ok: false, reason: "failed", error };
          }
        } finally {
          busy = false;
        }
      })();
      running = job;
      await job;

      const { value: result } = outcome;
      if (!result.ok && result.reason !== "failed" && result.reason !== "left") {
        setStatus({ kind: result.reason });
      } else if (latest === savedText) {
        setStatus({ kind: "saved" });
      } else if (before.kind === "retrying") {
        setStatus(before);
      } else {
        setStatus({ kind: "unsaved" });
      }
      publish();
      // The writer typed while the change ran, and the wait ended: save it now, on the new version.
      if (pendingAttempt && !blocked()) void attempt();
      return result;
    },

    abandon() {
      left = true;
      stopTimers();
      listeners.clear();
    },
  };
}
