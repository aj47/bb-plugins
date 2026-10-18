import { spawn } from "node:child_process";
import { parseHttpUrl } from "./url.js";

export const DEFAULT_CHROME_APP_NAME = "Google Chrome";

export interface OpenInChromeCommand {
  command: string;
  args: string[];
}

export interface OpenInChromeSpawnResult {
  code: number | null;
  stderr: string;
}

export function chromeOpenCommand(
  platform: NodeJS.Platform,
  url: string,
  appName = DEFAULT_CHROME_APP_NAME,
): OpenInChromeCommand {
  const href = parseHttpUrl(url).href;
  if (platform === "darwin") {
    return { command: "open", args: ["-a", appName, href] };
  }
  if (platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/c", "start", "", "chrome", href],
    };
  }
  return { command: "google-chrome", args: [href] };
}

export interface ChromeSpawnChild {
  stderr: {
    on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  } | null;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "close", listener: (code: number | null) => void): unknown;
}

export type ChromeSpawn = (
  command: string,
  args: readonly string[],
  options: { readonly stdio: readonly ["ignore", "ignore", "pipe"] },
) => ChromeSpawnChild;

export function spawnOpenInChrome(
  command: OpenInChromeCommand,
  spawnImpl: ChromeSpawn = spawn,
): Promise<OpenInChromeSpawnResult> {
  return new Promise((resolve, reject) => {
    let child: ChromeSpawnChild;
    try {
      child = spawnImpl(command.command, command.args, {
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch (error) {
      reject(error);
      return;
    }
    const stderrChunks: Buffer[] = [];
    child.stderr?.on("data", (chunk) => {
      stderrChunks.push(Buffer.from(chunk));
    });
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({
        code,
        stderr: Buffer.concat(stderrChunks).toString("utf8").trim(),
      });
    });
  });
}

export async function openUrlInChrome(args: {
  url: string;
  platform?: NodeJS.Platform;
  appName?: string;
  spawn?: ChromeSpawn;
}): Promise<{ url: string }> {
  const href = parseHttpUrl(args.url).href;
  const command = chromeOpenCommand(
    args.platform ?? process.platform,
    href,
    args.appName ?? DEFAULT_CHROME_APP_NAME,
  );
  let result: OpenInChromeSpawnResult;
  try {
    result = await spawnOpenInChrome(command, args.spawn ?? spawn);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to launch Chrome: ${message}`);
  }
  if (result.code !== 0) {
    const detail = result.stderr === "" ? `exit ${result.code}` : result.stderr;
    throw new Error(`Chrome did not open the URL (${detail})`);
  }
  return { url: href };
}
