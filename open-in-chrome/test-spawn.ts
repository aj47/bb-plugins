import type { ChromeSpawn, ChromeSpawnChild } from "./chrome.ts";

export class FakeChromeChild implements ChromeSpawnChild {
  private readonly dataListeners: Array<(chunk: Buffer | string) => void> = [];
  private errorListener: ((error: Error) => void) | null = null;
  private closeListener: ((code: number | null) => void) | null = null;

  stderr = {
    on: (_event: "data", listener: (chunk: Buffer | string) => void) => {
      this.dataListeners.push(listener);
      return this.stderr;
    },
  };

  once(event: "error", listener: (error: Error) => void): this;
  once(event: "close", listener: (code: number | null) => void): this;
  once(
    event: "error" | "close",
    listener: ((error: Error) => void) | ((code: number | null) => void),
  ): this {
    if (event === "error") {
      this.errorListener = listener as (error: Error) => void;
    } else {
      this.closeListener = listener as (code: number | null) => void;
    }
    return this;
  }

  emitStderr(chunk: Buffer | string): void {
    for (const listener of this.dataListeners) listener(chunk);
  }

  emitClose(code: number | null): void {
    this.closeListener?.(code);
  }

  emitError(error: Error): void {
    this.errorListener?.(error);
  }
}

export function fakeChromeSpawn(child: FakeChromeChild): ChromeSpawn {
  return () => child;
}
