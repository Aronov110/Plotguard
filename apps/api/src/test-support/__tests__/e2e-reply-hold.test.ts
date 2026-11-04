import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReplyHold, DEFAULT_MAX_HOLD_MS } from "../e2e-reply-hold.ts";

/** True when the promise has already resolved (checked after the pending microtasks ran). */
async function isSettled(promise: Promise<void>): Promise<boolean> {
  const marker = Symbol("pending");
  const result = await Promise.race([promise, Promise.resolve(marker)]);
  return result !== marker;
}

describe("createReplyHold", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets every reply through while nothing is armed", async () => {
    const hold = createReplyHold();
    expect(await isSettled(hold.waitIfArmed())).toBe(true);
    expect(await isSettled(hold.waitIfArmed())).toBe(true);
  });

  it("holds the next reply until it is released", async () => {
    const hold = createReplyHold();
    hold.arm();
    const held = hold.waitIfArmed();
    expect(await isSettled(held)).toBe(false);
    hold.release();
    expect(await isSettled(held)).toBe(true);
  });

  it("holds only one reply per arm", async () => {
    const hold = createReplyHold();
    hold.arm();
    const first = hold.waitIfArmed();
    const second = hold.waitIfArmed();
    expect(await isSettled(second)).toBe(true);
    expect(await isSettled(first)).toBe(false);
    hold.release();
    expect(await isSettled(first)).toBe(true);
  });

  it("does not hold after a release that came before the reply", async () => {
    const hold = createReplyHold();
    hold.arm();
    hold.release();
    expect(await isSettled(hold.waitIfArmed())).toBe(true);
  });

  it("does nothing when released without being armed", async () => {
    const hold = createReplyHold();
    expect(() => hold.release()).not.toThrow();
    expect(await isSettled(hold.waitIfArmed())).toBe(true);
  });

  it("treats arming twice before a reply as one hold", async () => {
    const hold = createReplyHold();
    hold.arm();
    hold.arm();
    const held = hold.waitIfArmed();
    expect(await isSettled(held)).toBe(false);
    hold.release();
    expect(await isSettled(held)).toBe(true);
    expect(await isSettled(hold.waitIfArmed())).toBe(true);
  });

  it("lets go of the held reply when it is armed again", async () => {
    const hold = createReplyHold();
    hold.arm();
    const first = hold.waitIfArmed();
    hold.arm();
    expect(await isSettled(first)).toBe(true);
    const second = hold.waitIfArmed();
    expect(await isSettled(second)).toBe(false);
    hold.release();
    expect(await isSettled(second)).toBe(true);
  });

  it("can be used again after a release", async () => {
    const hold = createReplyHold();
    hold.arm();
    const first = hold.waitIfArmed();
    hold.release();
    await first;
    hold.arm();
    const second = hold.waitIfArmed();
    expect(await isSettled(second)).toBe(false);
    hold.release();
    expect(await isSettled(second)).toBe(true);
  });

  it("lets the reply go by itself after the longest hold time", async () => {
    const hold = createReplyHold();
    hold.arm();
    const held = hold.waitIfArmed();
    await vi.advanceTimersByTimeAsync(DEFAULT_MAX_HOLD_MS - 1);
    expect(await isSettled(held)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await isSettled(held)).toBe(true);
  });

  it("uses the longest hold time it was given", async () => {
    const hold = createReplyHold(50);
    hold.arm();
    const held = hold.waitIfArmed();
    await vi.advanceTimersByTimeAsync(50);
    expect(await isSettled(held)).toBe(true);
  });

  it("leaves no timer behind after a release", async () => {
    const hold = createReplyHold();
    hold.arm();
    void hold.waitIfArmed();
    expect(vi.getTimerCount()).toBe(1);
    hold.release();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts no timer for a reply that is not held", () => {
    const hold = createReplyHold();
    void hold.waitIfArmed();
    expect(vi.getTimerCount()).toBe(0);
  });
});
