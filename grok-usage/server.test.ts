import {
  createFakePluginHost,
  makeHostResponse,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin from "./server.ts";
import { GET_RESOURCE_METHOD, LIST_RESOURCES_METHOD } from "./usage-contract.ts";

const connectedHost = makeHostResponse({
  id: "host_local",
  name: "Mac",
  status: "connected",
});

const okUsage = {
  accountKey: "xai:grok:user-1",
  observedAt: 1_700_000_000_000,
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
        usedPercent: 14,
        resetsAt: "2026-08-24T17:33:48.278Z",
        model: null,
        cost: null,
      },
    ],
  },
};

describe("grok-usage server", () => {
  it("lists Grok Build as a host-local usage resource", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "grok-usage",
      experimental_callHostRpc: async () => okUsage,
      sdk: {
        hosts: {
          list: async () => [connectedHost],
          get: async () => connectedHost,
        },
      },
    });

    await plugin(bb);
    await expect(harness.behavior.callRpc(LIST_RESOURCES_METHOD, {})).resolves.toEqual({
      resources: [
        {
          accountKey: null,
          id: JSON.stringify(["host_local", "acp-grok"]),
          providerId: "acp-grok",
          label: "Grok Build",
          scope: { kind: "host", hostId: "host_local", hostName: "Mac" },
        },
      ],
    });
    await harness.lifecycle.dispose();
  });

  it("collects usage through host RPC", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "grok-usage",
      experimental_callHostRpc: async ({ method, input, hostId }) => {
        expect(method).toBe("collectUsage");
        expect(hostId).toBe("host_local");
        expect(input).toEqual({ refresh: true });
        return okUsage;
      },
      sdk: {
        hosts: {
          list: async () => [connectedHost],
          get: async () => connectedHost,
        },
      },
    });

    await plugin(bb);
    await expect(
      harness.behavior.callRpc(GET_RESOURCE_METHOD, {
        resourceId: JSON.stringify(["host_local", "acp-grok"]),
        refresh: true,
      }),
    ).resolves.toEqual(okUsage);
    await harness.lifecycle.dispose();
  });
});
