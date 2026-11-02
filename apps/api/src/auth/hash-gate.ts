import { ServiceBusyError } from "../errors/app-error.ts";

interface Waiting {
  readonly start: () => void;
}

/**
 * Limits how many password hashes run at the same time. A hash needs about 19 MiB of memory and a
 * worker thread, so an unlimited burst of logins could exhaust both. Extra work waits in a short
 * queue; when even the queue is full the caller gets a {@link ServiceBusyError} (503) at once
 * instead of piling up more work.
 */
export class HashGate {
  readonly #maxConcurrent: number;
  readonly #maxQueue: number;
  readonly #queue: Waiting[] = [];
  #running = 0;

  // The default is 3, not 4: Node's helper-thread pool has 4 threads by default, and the hashes
  // run on it. Four at once would leave no thread for files, DNS or random bytes.
  constructor(maxConcurrent = 3, maxQueue = 50) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new RangeError("maxConcurrent must be a whole number of at least 1");
    }
    if (!Number.isInteger(maxQueue) || maxQueue < 0) {
      throw new RangeError("maxQueue must be a whole number of at least 0");
    }
    this.#maxConcurrent = maxConcurrent;
    this.#maxQueue = maxQueue;
  }

  /** How many tasks run and wait right now. */
  get stats(): { running: number; queued: number } {
    return { running: this.#running, queued: this.#queue.length };
  }

  /** Runs `task` as soon as a slot is free. Rejects with ServiceBusyError if the queue is full. */
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.#running >= this.#maxConcurrent) {
      if (this.#queue.length >= this.#maxQueue) throw new ServiceBusyError();
      await new Promise<void>((resolve) => {
        this.#queue.push({ start: resolve });
      });
    } else {
      this.#running++;
    }
    // A slot is now ours: either taken above, or handed over by release() without freeing it.
    try {
      return await task();
    } finally {
      this.#release();
    }
  }

  #release(): void {
    const next = this.#queue.shift();
    if (next === undefined) {
      this.#running--;
    } else {
      // Hand the slot straight to the next task: #running stays the same.
      next.start();
    }
  }
}
