import {
  createFakePluginHost,
  makeHostResponse,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin from "./server.ts";

const connectedHost = makeHostResponse({
  id: "host_local",
  name: "Mac",
  status: "connected",
});

describe("open-in-chrome server", () => {
  it("opens a URL through host RPC on the only connected machine", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "open-in-chrome",
      experimental_callHostRpc: async ({ method, input, hostId }) => {
        expect(method).toBe("openUrl");
        expect(hostId).toBe("host_local");
        expect(input).toEqual({ url: "https://example.com/" });
        return { url: "https://example.com/" };
      },
      sdk: {
        hosts: {
          list: async () => [connectedHost],
        },
      },
    });

    await plugin(bb);
    await expect(
      harness.behavior.callRpc("openUrl", { url: "https://example.com" }),
    ).resolves.toEqual({ url: "https://example.com/" });
    expect(harness.inspection.experimental_hostRpcCalls).toEqual([
      {
        method: "openUrl",
        input: { url: "https://example.com/" },
        hostId: "host_local",
      },
    ]);
    await harness.lifecycle.dispose();
  });

  it("opens a URL from the CLI", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "open-in-chrome",
      experimental_callHostRpc: async () => ({
        url: "https://github.com/get-bb/bb",
      }),
      sdk: {
        hosts: {
          list: async () => [connectedHost],
        },
      },
    });

    await plugin(bb);
    const result = await harness.behavior.runCli([
      "open",
      "https://github.com/get-bb/bb",
    ]);
    expect(result).toEqual({
      exitCode: 0,
      stdout: "Opened https://github.com/get-bb/bb in Chrome",
      stderr: "",
    });
    await harness.lifecycle.dispose();
  });
});
