import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { collectGrokUsage, type CollectedUsage } from "./collect.ts";
import { hostContract } from "./contract.ts";
import { CACHE_TTL_MS } from "./usage-contract.ts";

export function createGrokUsageHostEntry(
  collect: typeof collectGrokUsage = collectGrokUsage,
  now: () => number = Date.now,
) {
  let cached: CollectedUsage | null = null;
  let loadedAt = 0;
  let inFlight: Promise<CollectedUsage> | null = null;

  async function load(refresh: boolean): Promise<CollectedUsage> {
    if (!refresh && cached !== null && now() - loadedAt < CACHE_TTL_MS) {
      return cached;
    }
    if (inFlight) return inFlight;
    inFlight = collect()
      .then((collected) => {
        cached = collected;
        loadedAt = now();
        return collected;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  return experimental_defineHostEntry({
    contract: hostContract,
    handlers: {
      async collectUsage({ refresh }) {
        const collected = await load(refresh);
        return {
          accountKey: collected.accountKey,
          observedAt: collected.usage.status === "ok" ? loadedAt : null,
          usage: collected.usage,
        };
      },
    },
  });
}

export default createGrokUsageHostEntry();
