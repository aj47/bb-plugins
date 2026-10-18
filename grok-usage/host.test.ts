import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { describe, expect, it, vi } from "vitest";
import { createGrokUsageHostEntry } from "./host.ts";

const okUsage = {
  accountKey: "xai:grok:user-1",
  usage: {
    status: "ok" as const,
    plan: { id: "supergrok", multiplier: null },
    accountEmail: "aj@example.com",
    planLabel: "SuperGrok",
    windows: [
      {
        kind: "weekly" as const,
        id: "pool",
        label: "Weekly limit",
        usedPercent: 10,
        resetsAt: "2026-08-24T17:33:48.278Z",
        model: null,
        cost: null,
      },
    ],
  },
};

describe("grok-usage host entry", () => {
  it("caches a successful reading until refresh", async () => {
    const collect = vi.fn(async () => okUsage);
    let now = 1_000;
    const harness = experimental_createHostEntryHarness(
      createGrokUsageHostEntry(collect, () => now),
    );

    const first = await harness.experimental_call("collectUsage", { refresh: false });
    now = 2_000;
    const second = await harness.experimental_call("collectUsage", { refresh: false });
    expect(collect).toHaveBeenCalledTimes(1);
    expect(first.observedAt).toBe(1_000);
    expect(second).toEqual(first);

    await harness.experimental_call("collectUsage", { refresh: true });
    expect(collect).toHaveBeenCalledTimes(2);
    await harness.experimental_dispose();
  });
});
