import {
  PluginCliError,
  cliCommand,
  defineCli,
  defineRpcContract,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { hostContract } from "./contract.js";
import { parseHttpUrl } from "./url.js";

const urlInputSchema = z.object({ url: z.string().min(1).max(4096) }).strict();
const urlOutputSchema = z.object({ url: z.string() }).strict();

export const rpcContract = defineRpcContract({
  openUrl: {
    input: urlInputSchema,
    output: urlOutputSchema,
  },
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  const host = bb.hosts.experimental_client({ contract: hostContract });

  async function resolveHostId(explicitHostId?: string): Promise<string> {
    if (explicitHostId !== undefined) return explicitHostId;
    const hosts = await bb.sdk.hosts.list();
    const connected = hosts.filter((candidate) => candidate.status === "connected");
    if (connected.length === 1) return connected[0]!.id;
    if (connected.length === 0) {
      throw new Error("no connected machine is available to open Chrome");
    }
    throw new Error(
      "more than one connected machine; pass --host <host-id> from `bb machine list`",
    );
  }

  async function openUrl(url: string, hostId?: string): Promise<{ url: string }> {
    const href = parseHttpUrl(url).href;
    const targetHostId = await resolveHostId(hostId);
    try {
      return await host.call("openUrl", { url: href }, { hostId: targetHostId });
    } catch (error) {
      throw new Error(errorMessage(error));
    }
  }

  bb.rpc.register(rpcContract, {
    openUrl: ({ url }) => openUrl(url),
  });

  bb.cli.register(
    defineCli({
      name: "open-in-chrome",
      summary: "Open HTTP(S) links from bb in Google Chrome",
      description:
        "Intercepts ordinary link clicks in the bb app and opens them in Google Chrome on a connected machine.",
      commands: {
        open: cliCommand({
          summary: "Open a URL in Google Chrome",
          positionals: [
            {
              name: "url",
              description: "http or https URL to open",
              required: true,
            },
          ],
          options: {
            host: {
              type: "string",
              description: "Connected machine that should launch Chrome",
            },
            json: {
              type: "boolean",
              description: "Emit machine-readable JSON",
            },
          },
          async run(input) {
            try {
              const result = await openUrl(
                input.positionals.url,
                input.options.host,
              );
              if (input.options.json) {
                return { exitCode: 0, stdout: JSON.stringify(result) };
              }
              return { exitCode: 0, stdout: `Opened ${result.url} in Chrome` };
            } catch (error) {
              throw new PluginCliError(errorMessage(error), {
                code: "open_failed",
                hint: "Confirm Google Chrome is installed on the target machine and that the machine is connected.",
              });
            }
          },
        }),
      },
    }),
  );

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
