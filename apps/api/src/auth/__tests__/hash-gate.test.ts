import { describe, expect, it } from "vitest";
import { ServiceBusyError } from "../../errors/app-error.ts";
import { HashGate } from "../hash-gate.ts";

/** A task that stays running until `finish()` is called, so tests control the timing. */
function controlledTask<T>(result: T) {
  let finish: () => void = () => {};
  const started = Promise.withResolvers<void>();
  const promise = new Promise<T>((resolve) => {
    finish = () => resolve(result);
  });
  const task = () => {
    started.resolve();
    return promise;
  };
  return { task, finish: () => finish(), started: started.promise };
}

describe("HashGate", () => {
  it("by default runs 3 at a time: Node's helper-thread pool has 4 threads, and one must stay free", async () => {
    const gate = new HashGate();
    let running = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 12 }, () =>
        gate.run(async () => {
          running++;
          peak = Math.max(peak, running);
          await new Promise((resolve) => setTimeout(resolve, 3));
          running--;
        }),
      ),
    );
    expect(peak).toBe(3);
  });

  it("returns the result of the task", async () => {
    const gate = new HashGate(2, 5);
    await expect(gate.run(async () => 42)).resolves.toBe(42);
  });

  it("never runs more tasks at once than the limit", async () => {
    const gate = new HashGate(3, 100);
    let running = 0;
    let peak = 0;
    const tasks = Array.from({ length: 20 }, () =>
      gate.run(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 2));
        running--;
      }),
    );
    await Promise.all(tasks);
    expect(peak).toBe(3);
  });

  it("starts queued tasks in the order they arrived", async () => {
    const gate = new HashGate(1, 10);
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        gate.run(async () => {
          order.push(n);
        }),
      ),
    );
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it("rejects with ServiceBusyError when the queue is full", async () => {
    const gate = new HashGate(1, 2);
    const running = controlledTask("a");
    const first = gate.run(running.task);
    await running.started;
    const queued = [gate.run(async () => "b"), gate.run(async () => "c")];

    await expect(gate.run(async () => "d")).rejects.toBeInstanceOf(ServiceBusyError);

    running.finish();
    await expect(first).resolves.toBe("a");
    await expect(Promise.all(queued)).resolves.toEqual(["b", "c"]);
  });

  it("accepts work again once the queue has drained", async () => {
    const gate = new HashGate(1, 0);
    const running = controlledTask("a");
    const first = gate.run(running.task);
    await running.started;
    await expect(gate.run(async () => "b")).rejects.toBeInstanceOf(ServiceBusyError);
    running.finish();
    await first;
    await expect(gate.run(async () => "c")).resolves.toBe("c");
  });

  it("releases the slot when a task rejects", async () => {
    const gate = new HashGate(1, 5);
    await expect(
      gate.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(gate.run(async () => "after")).resolves.toBe("after");
  });

  it("handles a task that throws synchronously", async () => {
    const gate = new HashGate(1, 5);
    await expect(
      gate.run((() => {
        throw new Error("sync boom");
      }) as () => Promise<never>),
    ).rejects.toThrow("sync boom");
    await expect(gate.run(async () => "after")).resolves.toBe("after");
  });

  it("keeps working after a rejection while others are queued", async () => {
    const gate = new HashGate(1, 5);
    const results = await Promise.allSettled([
      gate.run(async () => {
        throw new Error("first fails");
      }),
      gate.run(async () => "second ok"),
      gate.run(async () => "third ok"),
    ]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "fulfilled", "fulfilled"]);
  });

  it("reports how busy it is", async () => {
    const gate = new HashGate(1, 5);
    expect(gate.stats).toEqual({ running: 0, queued: 0 });
    const running = controlledTask("a");
    const first = gate.run(running.task);
    await running.started;
    const second = gate.run(async () => "b");
    expect(gate.stats).toEqual({ running: 1, queued: 1 });
    running.finish();
    await Promise.all([first, second]);
    expect(gate.stats).toEqual({ running: 0, queued: 0 });
  });

  it.each([
    [0, 5],
    [-1, 5],
    [1.5, 5],
    [Number.NaN, 5],
    [1, -1],
    [1, 1.5],
    [1, Number.POSITIVE_INFINITY],
  ])("rejects the settings (%s, %s)", (concurrency, queue) => {
    expect(() => new HashGate(concurrency, queue)).toThrow(RangeError);
  });
});
