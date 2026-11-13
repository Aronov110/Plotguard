import { describe, expect, it, vi } from "vitest";
import {
  applyPreference,
  isThemePreference,
  readPreference,
  THEME_STORAGE_KEY,
  writePreference,
} from "../theme.ts";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

describe("isThemePreference", () => {
  it.each(["system", "light", "dark"])("accepts %s", (value) => {
    expect(isThemePreference(value)).toBe(true);
  });

  it.each([null, undefined, "", "LIGHT", "Dark", "auto", "constructor", "__proto__", 1, {}])(
    "refuses %j",
    (value) => {
      expect(isThemePreference(value)).toBe(false);
    },
  );
});

describe("readPreference", () => {
  it("is system when nothing was saved", () => {
    expect(readPreference(fakeStorage())).toBe("system");
  });

  it.each(["light", "dark", "system"] as const)("gives back a saved %s", (value) => {
    expect(readPreference(fakeStorage({ [THEME_STORAGE_KEY]: value }))).toBe(value);
  });

  it.each(["bogus", "", "LIGHT", "{}", "null", "constructor"])(
    "is system for a saved value that means nothing (%j)",
    (value) => {
      expect(readPreference(fakeStorage({ [THEME_STORAGE_KEY]: value }))).toBe("system");
    },
  );

  it("is system when there is no storage at all", () => {
    expect(readPreference(undefined)).toBe("system");
  });

  it("is system when reading the storage throws (blocked storage)", () => {
    const blocked = {
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
    };
    expect(readPreference(blocked)).toBe("system");
  });
});

describe("writePreference", () => {
  it.each(["light", "dark"] as const)("saves %s", (value) => {
    const storage = fakeStorage();
    writePreference(value, storage);
    expect(storage.data.get(THEME_STORAGE_KEY)).toBe(value);
  });

  it("forgets the saved value for system, which is the default", () => {
    const storage = fakeStorage({ [THEME_STORAGE_KEY]: "dark" });
    writePreference("system", storage);
    expect(storage.data.has(THEME_STORAGE_KEY)).toBe(false);
  });

  it("does not fail when the storage is missing or blocked", () => {
    expect(() => {
      writePreference("dark", undefined);
    }).not.toThrow();
    const blocked = {
      setItem: vi.fn(() => {
        throw new DOMException("full", "QuotaExceededError");
      }),
      removeItem: vi.fn(() => {
        throw new DOMException("full", "QuotaExceededError");
      }),
    };
    expect(() => {
      writePreference("dark", blocked);
      writePreference("system", blocked);
    }).not.toThrow();
  });

  it("stores nothing but the one word", () => {
    const storage = fakeStorage();
    writePreference("dark", storage);
    expect([...storage.data.entries()]).toEqual([[THEME_STORAGE_KEY, "dark"]]);
  });
});

describe("applyPreference", () => {
  it.each(["light", "dark"] as const)("marks the page with the chosen theme %s", (value) => {
    const root = document.createElement("html");
    applyPreference(value, root);
    expect(root.getAttribute("data-theme")).toBe(value);
  });

  it("removes the mark for system, so the system's own setting decides", () => {
    const root = document.createElement("html");
    root.setAttribute("data-theme", "dark");
    applyPreference("system", root);
    expect(root.hasAttribute("data-theme")).toBe(false);
  });

  it("changes from one theme to another", () => {
    const root = document.createElement("html");
    applyPreference("dark", root);
    applyPreference("light", root);
    expect(root.getAttribute("data-theme")).toBe("light");
  });

  it("uses the page's own root element when none is given", () => {
    applyPreference("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    applyPreference("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});
