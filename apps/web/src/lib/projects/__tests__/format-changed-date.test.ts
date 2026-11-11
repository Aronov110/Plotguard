import { describe, expect, it } from "vitest";
import { formatChangedDate } from "../format-changed-date.ts";

describe("formatChangedDate", () => {
  it("writes the day, the short month and the year, in the language asked for", () => {
    expect(formatChangedDate("2026-11-07T12:00:00.000Z", "en-GB", "UTC")).toBe("7 Nov 2026");
    expect(formatChangedDate("2026-11-07T12:00:00.000Z", "en-US", "UTC")).toBe("Nov 7, 2026");
  });

  it("shows the day in the reader's own time zone", () => {
    const iso = "2026-11-07T23:30:00.000Z";
    expect(formatChangedDate(iso, "en-GB", "UTC")).toBe("7 Nov 2026");
    expect(formatChangedDate(iso, "en-GB", "Asia/Tokyo")).toBe("8 Nov 2026");
    expect(formatChangedDate(iso, "en-GB", "America/Los_Angeles")).toBe("7 Nov 2026");
  });

  it("reads the timestamps the API sends, with or without milliseconds", () => {
    expect(formatChangedDate("2026-01-02T03:04:05Z", "en-GB", "UTC")).toBe("2 Jan 2026");
    expect(formatChangedDate("2026-01-02T03:04:05.678Z", "en-GB", "UTC")).toBe("2 Jan 2026");
  });

  it("uses the browser's language and zone when none is given", () => {
    expect(formatChangedDate("2026-11-07T12:00:00.000Z")).toMatch(/2026/);
  });

  it.each([
    ["an empty string", ""],
    ["text", "yesterday"],
    ["a made-up date", "2026-13-45T00:00:00Z"],
  ])("returns nothing for %s, instead of 'Invalid Date'", (_name, value) => {
    expect(formatChangedDate(value, "en-GB", "UTC")).toBeUndefined();
  });
});
