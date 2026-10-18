import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { describe, expect, it, vi } from "vitest";
import { createOpenInChromeHostEntry } from "./host.ts";
import { FakeChromeChild } from "./test-spawn.ts";

describe("open-in-chrome host entry", () => {
  it("opens a validated URL through the Chrome launcher", async () => {
    const child = new FakeChromeChild();
    const spawn = vi.fn(() => {
      queueMicrotask(() => child.emitClose(0));
      return child;
    });
    const harness = experimental_createHostEntryHarness(
      createOpenInChromeHostEntry(spawn),
    );

    await expect(
      harness.experimental_call("openUrl", { url: "https://example.com" }),
    ).resolves.toEqual({ url: "https://example.com/" });
    expect(spawn).toHaveBeenCalledWith(
      "open",
      ["-a", "Google Chrome", "https://example.com/"],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    await harness.experimental_dispose();
  });

  it("rejects a non-http URL before launching Chrome", async () => {
    const spawn = vi.fn();
    const harness = experimental_createHostEntryHarness(
      createOpenInChromeHostEntry(spawn),
    );
    await expect(
      harness.experimental_call("openUrl", { url: "mailto:aj@example.com" }),
    ).rejects.toThrow();
    expect(spawn).not.toHaveBeenCalled();
    await harness.experimental_dispose();
  });
});
