/** The name of the browser channel that tabs of this site use to talk to each other. */
export const AUTH_CHANNEL_NAME = "plotpal-auth";

/**
 * The only message ever sent: a fixed word. No token, no user, no email. A tab that hears it ends
 * its own login, because the access token of a tab that signed out is useless but another tab of
 * the same browser would otherwise keep working with its own token until that expires.
 */
export const SIGNED_OUT_MESSAGE = "signed-out";

/** The parts of the browser's BroadcastChannel that this module uses. */
export interface ChannelLike {
  postMessage(message: unknown): void;
  close(): void;
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
}

/** Opens a channel, or returns `undefined` when the browser has none (Safari before 15.4). */
export type ChannelFactory = (name: string) => ChannelLike | undefined;

export interface AuthBroadcast {
  /** Tells the other tabs of this browser that this one signed out. */
  announceSignOut(): void;
  /**
   * Calls `listener` when another tab signs out.
   * @returns a function that stops the calls.
   */
  onSignOut(listener: () => void): () => void;
}

const browserChannel: ChannelFactory = (name) =>
  typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel(name);

/**
 * Creates the link between tabs. It only holds a channel open while somebody is listening, so a
 * tab that is not part of the app any more leaves nothing behind. Without a channel in the browser
 * it does nothing, and tabs simply learn about a sign-out later, from their own expired token.
 */
export function createAuthBroadcast(openChannel: ChannelFactory = browserChannel): AuthBroadcast {
  const listeners = new Set<{ readonly call: () => void }>();
  let channel: ChannelLike | undefined;

  const onMessage = (event: { readonly data: unknown }): void => {
    // Anything but the one fixed word is ignored: other pages of this site must not be able to
    // sign a tab out by sending something clever.
    if (event.data !== SIGNED_OUT_MESSAGE) return;
    for (const listener of [...listeners]) listener.call();
  };

  return {
    announceSignOut() {
      if (channel !== undefined) {
        // Our own channel never hears what it sends, so this tab does not react to itself.
        channel.postMessage(SIGNED_OUT_MESSAGE);
        return;
      }
      // Nobody is listening here, so open a channel only for as long as the sending takes. A
      // message that is already sent still arrives when the channel is closed right after.
      const temporary = openChannel(AUTH_CHANNEL_NAME);
      if (temporary === undefined) return;
      try {
        temporary.postMessage(SIGNED_OUT_MESSAGE);
      } finally {
        temporary.close();
      }
    },

    onSignOut(listener) {
      const entry = { call: listener };
      listeners.add(entry);
      if (channel === undefined) {
        channel = openChannel(AUTH_CHANNEL_NAME);
        channel?.addEventListener("message", onMessage);
      }
      return () => {
        if (!listeners.delete(entry)) return;
        if (listeners.size === 0 && channel !== undefined) {
          channel.removeEventListener("message", onMessage);
          channel.close();
          channel = undefined;
        }
      };
    },
  };
}
