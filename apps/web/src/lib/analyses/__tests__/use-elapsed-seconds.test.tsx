import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useElapsedSeconds } from "../use-elapsed-seconds.ts";

const START = "2026-11-12T10:00:00.000Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-12T10:00:05.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useElapsedSeconds", () => {
  it("starts with the seconds since the timestamp", () => {
    const { result } = renderHook(() => useElapsedSeconds(START, true));
    expect(result.current).toBe(5);
  });

  it("counts on every second while active", () => {
    const { result } = renderHook(() => useElapsedSeconds(START, true));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current).toBe(8);
  });

  it("stops counting when it is no longer active", () => {
    const { result, rerender } = renderHook(({ active }) => useElapsedSeconds(START, active), {
      initialProps: { active: true },
    });
    rerender({ active: false });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current).toBe(5);
  });

  it("clears its timer when it goes away", () => {
    const { unmount } = renderHook(() => useElapsedSeconds(START, true));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never goes below zero when this clock is behind the server's", () => {
    const { result } = renderHook(() => useElapsedSeconds("2026-11-12T10:01:00.000Z", true));
    expect(result.current).toBe(0);
  });

  it("gives nothing for a timestamp that is not a date", () => {
    const { result } = renderHook(() => useElapsedSeconds("nope", true));
    expect(result.current).toBeUndefined();
  });
});
