import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY } from "../theme.ts";
import { useTheme } from "../use-theme.ts";

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useTheme", () => {
  it("starts as system, with nothing on the page", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("starts from the saved choice and marks the page with it", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("ignores a saved value that means nothing", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "purple");
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe("system");
  });

  it("saves a new choice and puts it on the page", () => {
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.setPreference("light");
    });
    expect(result.current.preference).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("goes back to the system's setting by forgetting the choice", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.setPreference("system");
    });
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("still changes the page when the storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.setPreference("dark");
    });
    expect(result.current.preference).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("follows a change made in another tab", () => {
    const { result } = renderHook(() => useTheme());
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY }));
    });
    expect(result.current.preference).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("follows the storage being cleared in another tab", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const { result } = renderHook(() => useTheme());
    window.localStorage.clear();
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(result.current.preference).toBe("system");
  });

  it("ignores changes to other keys", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const { result } = renderHook(() => useTheme());
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "something-else" }));
    });
    expect(result.current.preference).toBe("dark");
  });

  it("stops listening when it is removed", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useTheme());
    unmount();
    expect(remove).toHaveBeenCalledWith("storage", expect.any(Function));
  });
});
