import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { hostContract } from "./contract.ts";
import {
  CACHE_TTL_MS,
  GET_RESOURCE_METHOD,
  GROK_PROVIDER_ID,
  GROK_PROVIDER_LABEL,
  LIST_RESOURCES_METHOD,
  usageSourceContract,
  type getResourceOutputSchema,
} from "./usage-contract.ts";
import type { z } from "zod";

type UsageResourceResult = z.infer<typeof getResourceOutputSchema>;

function resourceId(hostId: string): string {
  return JSON.stringify([hostId, GROK_PROVIDER_ID]);
}

function parseResourceId(value: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Usage resource no longer exists.");
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) {
    throw new Error("Usage resource no longer exists.");
  }
  const [hostId, providerId] = parsed;
  if (typeof hostId !== "string" || hostId.length === 0 || providerId !== GROK_PROVIDER_ID) {
    throw new Error("Usage resource no longer exists.");
  }
  return hostId;
}

function errorResult(message: string, previous?: UsageResourceResult): UsageResourceResult {
  return {
    accountKey: previous?.accountKey ?? null,
    observedAt: previous?.observedAt ?? null,
    usage: {
      status: "error",
      plan: null,
      accountEmail: previous?.usage.accountEmail ?? null,
      planLabel: previous?.usage.planLabel ?? null,
      message,
    },
  };
}

export default async function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const cache = new Map<string, { value: UsageResourceResult; loadedAt: number }>();
  const inflight = new Map<string, { refresh: boolean; promise: Promise<UsageResourceResult> }>();

  async function collect(id: string, refresh: boolean): Promise<UsageResourceResult> {
    const existing = inflight.get(id);
    if (existing) {
      if (!refresh || existing.refresh) return existing.promise;
      await existing.promise.catch(() => undefined);
      return collect(id, refresh);
    }

    const promise = (async () => {
      const hostId = parseResourceId(id);
      const machine = await bb.sdk.hosts.get({ hostId }).catch((error: unknown) => {
        if (error instanceof Error && "status" in error && error.status === 404) {
          throw new Error("Usage resource no longer exists.");
        }
        throw error;
      });
      const previous = cache.get(id)?.value;
      if (machine.status === "disconnected") {
        return errorResult("Machine is disconnected.", previous);
      }
      if (!refresh) {
        const cached = cache.get(id);
        if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS && cached.value.usage.status === "ok") {
          return cached.value;
        }
      }
      try {
        const result = await host.call(
          "collectUsage",
          { refresh },
          { hostId, timeoutMs: 20_000 },
        );
        cache.set(id, { value: result, loadedAt: Date.now() });
        return result;
      } catch {
        return errorResult("Usage could not be collected from this machine.", previous);
      }
    })().finally(() => {
      inflight.delete(id);
    });

    inflight.set(id, { refresh, promise });
    return promise;
  }

  bb.rpc.register(
    usageSourceContract,
    {
      async [LIST_RESOURCES_METHOD]() {
        const hosts = await bb.sdk.hosts.list();
        const resources = hosts
          .filter((candidate) => candidate.type !== "ephemeral")
          .map((candidate) => {
            const id = resourceId(candidate.id);
            return {
              id,
              accountKey: cache.get(id)?.value.accountKey ?? null,
              providerId: GROK_PROVIDER_ID,
              label: GROK_PROVIDER_LABEL,
              scope: {
                kind: "host" as const,
                hostId: candidate.id,
                hostName: candidate.name,
              },
            };
          });
        const liveIds = new Set(resources.map((resource) => resource.id));
        for (const id of cache.keys()) {
          if (!liveIds.has(id)) cache.delete(id);
        }
        return { resources };
      },
      [GET_RESOURCE_METHOD]: ({ resourceId: id, refresh }) => collect(id, refresh),
    },
    {
      experimental_discoverable: true,
      experimental_description:
        "Host-local Grok Build usage. Inventory reads metadata only. Independent of display plugins.",
    },
  );

  bb.cli.register(
    defineCli({
      name: "grok-usage",
      summary: "Show Grok Build quota",
      description:
        "Reads SuperGrok OAuth on a connected machine (Pi xAI login or grok login) and prints the weekly quota shown in Settings \u2192 Usage limits.",
      commands: {
        show: cliCommand({
          summary: "Show Grok Build usage for a connected machine",
          options: {
            host: {
              type: "string",
              description: "Machine whose Grok login should be read",
            },
            refresh: {
              type: "boolean",
              description: "Fetch a fresh reading instead of a cached one",
            },
            json: {
              type: "boolean",
              description: "Print machine-readable JSON",
            },
          },
          async run(input) {
            const hosts = (await bb.sdk.hosts.list()).filter(
              (candidate) => candidate.type !== "ephemeral" && candidate.status === "connected",
            );
            const selected =
              input.options.host === undefined
                ? hosts.length === 1
                  ? hosts[0]
                  : undefined
                : hosts.find(
                    (candidate) =>
                      candidate.id === input.options.host || candidate.name === input.options.host,
                  );
            if (!selected) {
              throw new PluginCliError(
                input.options.host
                  ? `no connected machine named ${input.options.host}`
                  : "pass --host <id-or-name> from `bb machine list`",
                { code: "host_required" },
              );
            }
            const result = await collect(resourceId(selected.id), input.options.refresh === true);
            if (input.options.json) {
              return { exitCode: 0, stdout: `${JSON.stringify(result, null, 2)}\n` };
            }
            const usage = result.usage;
            if (usage.status === "ok") {
              const window = usage.windows[0];
              const plan = usage.planLabel ?? "Grok Build";
              const reset = window?.resetsAt ? ` \u00b7 resets ${window.resetsAt}` : "";
              const percent = window ? `${Math.round(window.usedPercent)}% used` : "no windows";
              return {
                exitCode: 0,
                stdout: `${plan}: ${percent}${reset}\n`,
              };
            }
            if (usage.status === "error") {
              throw new PluginCliError(usage.message, { code: "usage_error" });
            }
            return {
              exitCode: 0,
              stdout: `Grok Build: ${usage.status}\n`,
            };
          },
        }),
      },
    }),
  );
}
