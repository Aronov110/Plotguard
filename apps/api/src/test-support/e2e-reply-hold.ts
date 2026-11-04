/**
 * A way for a browser test to hold back one server reply while the server has already done the
 * work. The end-to-end API uses it on the logout reply: the login is ended in the database at once,
 * but the answer (with the `Set-Cookie` headers that clear the cookies) reaches the browser only
 * when the test lets it go. That is the situation of a slow network, and it cannot be built from the
 * browser side, because re-sending a request from the test changes the request.
 */
export interface ReplyHold {
  /** The next reply that asks to wait is held until {@link ReplyHold.release}. Replaces an older arm. */
  arm(): void;
  /** Lets the held reply go. Does nothing when nothing is armed or held. */
  release(): void;
  /** Called for each reply: resolves at once, unless the hold is armed (then once, until released). */
  waitIfArmed(): Promise<void>;
}

/** Longest a reply is held, so a test that crashes cannot leave the server stuck. */
export const DEFAULT_MAX_HOLD_MS = 10_000;

interface Gate {
  readonly opened: Promise<void>;
  readonly open: () => void;
}

function createGate(): Gate {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

/** Creates a hold. One hold serves one test server; it holds at most one reply at a time. */
export function createReplyHold(maxHoldMs: number = DEFAULT_MAX_HOLD_MS): ReplyHold {
  let gate: Gate | undefined;
  let taken = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const release = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    gate?.open();
    gate = undefined;
    taken = false;
  };

  return {
    arm() {
      release();
      gate = createGate();
    },
    release,
    waitIfArmed() {
      if (gate === undefined || taken) return Promise.resolve();
      taken = true;
      timer = setTimeout(release, maxHoldMs);
      return gate.opened;
    },
  };
}
