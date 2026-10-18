import { describe, expect, it, vi } from "vitest";
import { chromeOpenCommand, openUrlInChrome } from "./chrome.ts";
import { FakeChromeChild } from "./test-spawn.ts";

describe("chromeOpenCommand", () => {
  it("uses macOS open -a Google Chrome", () => {
    expect(chromeOpenCommand("darwin", "https://example.com")).toEqual({
      command: "open",
      args: ["-a", "Google Chrome", "https://example.com/"],
    });
  });
});

describe("openUrlInChrome", () => {
  it("spawns Chrome and returns the normalized URL", async () => {
    const child = new FakeChromeChild();
    const spawn = vi.fn(() => {
      queueMicrotask(() => child.emitClose(0));
      return child;
    });
    await expect(
      openUrlInChrome({
        url: "https://example.com/docs",
        platform: "darwin",
        spawn,
      }),
    ).resolves.toEqual({ url: "https://example.com/docs" });
    expect(spawn).toHaveBeenCalledWith(
      "open",
      ["-a", "Google Chrome", "https://example.com/docs"],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
  });

  it("surfaces a failed launch", async () => {
    const child = new FakeChromeChild();
    const spawn = vi.fn(() => {
      queueMicrotask(() => {
        child.emitStderr("Unable to find application");
        child.emitClose(1);
      });
      return child;
    });
    await expect(
      openUrlInChrome({
        url: "https://example.com",
        platform: "darwin",
        spawn,
      }),
    ).rejects.toThrow(/Unable to find application/);
  });
});
