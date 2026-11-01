import { describe, expect, it, vi } from "vitest";
import { createDatabase } from "../client.ts";

const url = "postgres://user:pw@127.0.0.1:5432/app_test";

describe("createDatabase", () => {
  it("attaches an error listener so a broken idle connection cannot crash the process", async () => {
    const { pool, close } = createDatabase(url, { onPoolError: () => {} });
    try {
      expect(pool.listenerCount("error")).toBeGreaterThan(0);
      expect(() => pool.emit("error", new Error("idle client broke"))).not.toThrow();
    } finally {
      await close();
    }
  });

  it("passes pool errors to the supplied handler", async () => {
    const onPoolError = vi.fn();
    const { pool, close } = createDatabase(url, { onPoolError });
    try {
      const failure = new Error("connection terminated");
      pool.emit("error", failure);

      expect(onPoolError).toHaveBeenCalledTimes(1);
      expect(onPoolError).toHaveBeenCalledWith(failure);
    } finally {
      await close();
    }
  });

  it("logs the message by default, and never the connection string", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { pool, close } = createDatabase(url);
    try {
      pool.emit("error", new Error("boom"));

      expect(spy).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).toContain("boom");
      expect(logged).not.toContain("pw@");
      expect(logged).not.toContain(url);
    } finally {
      spy.mockRestore();
      await close();
    }
  });

  it("does not open a connection until the first query", async () => {
    const { pool, close } = createDatabase(url);
    try {
      expect(pool.totalCount).toBe(0);
    } finally {
      await close();
    }
  });
});
