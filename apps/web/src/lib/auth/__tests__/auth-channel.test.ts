import { describe, expect, it, vi } from "vitest";
import {
  AUTH_CHANNEL_NAME,
  type ChannelFactory,
  type ChannelLike,
  createAuthBroadcast,
  SIGNED_OUT_MESSAGE,
} from "../auth-channel.ts";

type Listener = (event: { readonly data: unknown }) => void;

/**
 * A stand-in for the browser's BroadcastChannel with its rules: a message goes to every other open
 * channel with the same name, never back to the channel that sent it.
 */
class FakeBus {
  readonly channels: FakeChannel[] = [];
  readonly factory: ChannelFactory = (name) => {
    const channel = new FakeChannel(name, this);
    this.channels.push(channel);
    return channel;
  };
  open(name = AUTH_CHANNEL_NAME): FakeChannel[] {
    return this.channels.filter((channel) => !channel.closed && channel.name === name);
  }
}

class FakeChannel implements ChannelLike {
  closed = false;
  readonly name: string;
  readonly posted: unknown[] = [];
  readonly #bus: FakeBus;
  readonly #listeners = new Set<Listener>();

  constructor(name: string, bus: FakeBus) {
    this.name = name;
    this.#bus = bus;
  }

  postMessage(message: unknown): void {
    if (this.closed) throw new Error("The channel is closed.");
    this.posted.push(message);
    for (const other of this.#bus.channels) {
      if (other !== this && !other.closed && other.name === this.name) other.deliver(message);
    }
  }

  close(): void {
    this.closed = true;
  }

  addEventListener(_type: "message", listener: Listener): void {
    this.#listeners.add(listener);
  }

  removeEventListener(_type: "message", listener: Listener): void {
    this.#listeners.delete(listener);
  }

  deliver(data: unknown): void {
    for (const listener of this.#listeners) listener({ data });
  }
}

describe("createAuthBroadcast", () => {
  it("uses a fixed channel name and message", () => {
    expect(AUTH_CHANNEL_NAME).toBe("plotpal-auth");
    expect(SIGNED_OUT_MESSAGE).toBe("signed-out");
  });

  it("tells another tab that someone signed out", () => {
    const bus = new FakeBus();
    const otherTab = createAuthBroadcast(bus.factory);
    const thisTab = createAuthBroadcast(bus.factory);
    const heard = vi.fn();
    otherTab.onSignOut(heard);

    thisTab.announceSignOut();

    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("sends nothing but the fixed word, so no token or user data can travel", () => {
    const bus = new FakeBus();
    const tab = createAuthBroadcast(bus.factory);

    tab.announceSignOut();

    const posted = bus.channels.flatMap((channel) => channel.posted);
    expect(posted).toEqual(["signed-out"]);
  });

  it("closes the short-lived channel it opened to send", () => {
    const bus = new FakeBus();
    createAuthBroadcast(bus.factory).announceSignOut();
    expect(bus.open()).toHaveLength(0);
  });

  it("sends through its own listening channel when it has one, so it does not hear itself", () => {
    const bus = new FakeBus();
    const thisTab = createAuthBroadcast(bus.factory);
    const otherTab = createAuthBroadcast(bus.factory);
    const heardHere = vi.fn();
    const heardThere = vi.fn();
    thisTab.onSignOut(heardHere);
    otherTab.onSignOut(heardThere);

    thisTab.announceSignOut();

    expect(heardHere).not.toHaveBeenCalled();
    expect(heardThere).toHaveBeenCalledTimes(1);
    expect(bus.channels).toHaveLength(2);
  });

  it("calls every listener of the same tab", () => {
    const bus = new FakeBus();
    const tab = createAuthBroadcast(bus.factory);
    const first = vi.fn();
    const second = vi.fn();
    tab.onSignOut(first);
    tab.onSignOut(second);

    createAuthBroadcast(bus.factory).announceSignOut();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(bus.channels.filter((channel) => channel.name === AUTH_CHANNEL_NAME)).toHaveLength(2);
  });

  it.each([
    ["another word", "signed-in"],
    ["different capitals", "SIGNED-OUT"],
    ["extra spaces", "signed-out "],
    ["an empty string", ""],
    ["a number", 1],
    ["null", null],
    ["undefined", undefined],
    ["an object", { type: "signed-out" }],
    ["an array", ["signed-out"]],
  ])("ignores a message that is %s", (_name, message) => {
    const bus = new FakeBus();
    const tab = createAuthBroadcast(bus.factory);
    const heard = vi.fn();
    tab.onSignOut(heard);

    bus.open()[0]?.deliver(message);

    expect(heard).not.toHaveBeenCalled();
  });

  it("stops calling a listener that unsubscribed", () => {
    const bus = new FakeBus();
    const tab = createAuthBroadcast(bus.factory);
    const heard = vi.fn();
    const unsubscribe = tab.onSignOut(heard);
    unsubscribe();

    createAuthBroadcast(bus.factory).announceSignOut();

    expect(heard).not.toHaveBeenCalled();
  });

  it("keeps the channel open while any listener is left and closes it after the last one", () => {
    const bus = new FakeBus();
    const tab = createAuthBroadcast(bus.factory);
    const unsubscribeFirst = tab.onSignOut(() => undefined);
    const unsubscribeSecond = tab.onSignOut(() => undefined);

    unsubscribeFirst();
    expect(bus.open()).toHaveLength(1);

    unsubscribeSecond();
    expect(bus.open()).toHaveLength(0);
  });

  it("can listen again after everyone left", () => {
    const bus = new FakeBus();
    const tab = createAuthBroadcast(bus.factory);
    tab.onSignOut(() => undefined)();
    const heard = vi.fn();
    tab.onSignOut(heard);

    createAuthBroadcast(bus.factory).announceSignOut();

    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("unsubscribing twice does nothing the second time", () => {
    const bus = new FakeBus();
    const tab = createAuthBroadcast(bus.factory);
    const other = tab.onSignOut(() => undefined);
    const unsubscribe = tab.onSignOut(() => undefined);
    unsubscribe();
    unsubscribe();
    expect(bus.open()).toHaveLength(1);
    other();
    expect(bus.open()).toHaveLength(0);
  });

  it("does nothing, without errors, when the browser has no BroadcastChannel", () => {
    const tab = createAuthBroadcast(() => undefined);
    const heard = vi.fn();
    const unsubscribe = tab.onSignOut(heard);
    expect(() => tab.announceSignOut()).not.toThrow();
    expect(() => unsubscribe()).not.toThrow();
    expect(heard).not.toHaveBeenCalled();
  });

  it("works with the real BroadcastChannel of this environment, and leaves nothing open", async () => {
    const receiver = createAuthBroadcast();
    const sender = createAuthBroadcast();
    const heard = vi.fn();
    const unsubscribe = receiver.onSignOut(heard);

    sender.announceSignOut();
    await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(1));

    unsubscribe();
  });
});
