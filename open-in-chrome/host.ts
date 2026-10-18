import { spawn } from "node:child_process";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { openUrlInChrome, type ChromeSpawn } from "./chrome.js";
import { hostContract } from "./contract.js";

export function createOpenInChromeHostEntry(
  spawnImpl: ChromeSpawn = spawn,
) {
  return experimental_defineHostEntry({
    contract: hostContract,
    handlers: {
      async openUrl({ url }) {
        return openUrlInChrome({ url, spawn: spawnImpl });
      },
    },
  });
}

export default createOpenInChromeHostEntry();
