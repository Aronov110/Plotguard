import { Writable } from "node:stream";

/** A writable stream that keeps every log line, so tests can assert on what was (not) logged. */
export class LogCollector extends Writable {
  readonly lines: string[] = [];

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void {
    this.lines.push(...chunk.toString().split("\n").filter(Boolean));
    callback();
  }

  get text(): string {
    return this.lines.join("\n");
  }

  get entries(): Record<string, unknown>[] {
    return this.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  }
}
