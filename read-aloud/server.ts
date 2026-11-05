// Read Aloud — backend.
//
// Keeps the set of threads with read-aloud on, watches their event streams,
// and pushes every finished assistant message to clients over realtime as
// speakable plain text. The client that has the thread open does the talking
// (Web Speech API), so audio comes out of whichever device you're looking at.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { toSpeech } from "./speech-text";

export const rpcContract = defineRpcContract({
  state: {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.object({ enabled: z.boolean() }),
  },
  set_enabled: {
    input: z.object({ threadId: z.string().min(1), enabled: z.boolean() }),
    output: z.object({ enabled: z.boolean() }),
  },
  enabled_threads: {
    input: z.null(),
    output: z.object({ threadIds: z.array(z.string()) }),
  },
  last_message: {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.object({ text: z.string().nullable() }),
  },
});

/** Realtime channels the app listens on. */
export const CHANNEL_SPEAK = "speak";
export const CHANNEL_STATE = "state";
/** The turn's final message, sent once when the thread goes idle. */
export const CHANNEL_DONE = "done";

export interface SpeakPayload {
  threadId: string;
  /** Stable per message, so a client never reads the same one twice. */
  id: string;
  text: string;
}

export interface StatePayload {
  threadId: string;
  enabled: boolean;
}

const ENABLED_KEY = "enabled-threads";

interface AgentMessageItem {
  type: "agentMessage";
  id: string;
  text: string;
  parentToolCallId?: string;
}

function agentMessageOf(data: unknown): AgentMessageItem | null {
  if (typeof data !== "object" || data === null) return null;
  const item = (data as { item?: unknown }).item;
  if (typeof item !== "object" || item === null) return null;
  const candidate = item as Partial<AgentMessageItem>;
  if (candidate.type !== "agentMessage") return null;
  if (typeof candidate.id !== "string" || typeof candidate.text !== "string")
    return null;
  return candidate as AgentMessageItem;
}

export default async function plugin(bb: BbPluginApi) {
  // Read by the app with useSettings(); the server doesn't need them.
  bb.settings.define({
    mode: {
      type: "select",
      label: "What to read",
      description:
        "Every message reads each update as the agent works. Final message only waits for the turn to finish.",
      options: ["all", "final"],
      experimental_optionLabels: { all: "Every message", final: "Final message only" },
      default: "all",
    },
    rate: {
      type: "number",
      label: "Speaking speed",
      description: "1 is normal. Try 1.2 to 1.5 to get through long replies faster.",
      default: 1.1,
    },
    voice: {
      type: "string",
      label: "Voice",
      description:
        "Part of a system voice name, e.g. Samantha, Daniel or Google UK English. Leave empty for the device default.",
      default: "",
    },
  });

  const enabled = new Set<string>(
    (await bb.storage.kv.get<string[]>(ENABLED_KEY)) ?? [],
  );
  /** Last event seq already read, per enabled thread. In memory only. */
  const cursors = new Map<string, number>();
  /** Serializes reads per thread so two notifications never double-speak. */
  const chains = new Map<string, Promise<void>>();
  let disposed = false;

  async function saveEnabled() {
    await bb.storage.kv.set(ENABLED_KEY, [...enabled]);
  }

  async function latestSeq(threadId: string): Promise<number> {
    const rows = await bb.sdk.threads.events.list({
      threadId,
      order: "desc",
      limit: "1",
    });
    return rows[0]?.seq ?? 0;
  }

  function serialize(threadId: string, work: () => Promise<void>) {
    const previous = chains.get(threadId) ?? Promise.resolve();
    const next = previous
      .then(work)
      .catch((error) => bb.log.warn(`read failed for ${threadId}: ${String(error)}`));
    chains.set(threadId, next);
    return next;
  }

  /** Publish every assistant message completed since the cursor. */
  function drain(threadId: string) {
    return serialize(threadId, async () => {
      if (disposed || !enabled.has(threadId)) return;
      let cursor = cursors.get(threadId);
      if (cursor === undefined) {
        // Started (or plugin reloaded) mid-thread: only read what comes next.
        cursors.set(threadId, await latestSeq(threadId));
        return;
      }
      const messages: { id: string; text: string }[] = [];
      for (let page = 0; page < 10; page += 1) {
        const rows = await bb.sdk.threads.events.list({
          threadId,
          afterSeq: String(cursor),
          types: ["item/completed"],
          limit: "100",
        });
        for (const row of rows) {
          cursor = Math.max(cursor, row.seq);
          const item = agentMessageOf(row.data);
          // Skip subagent chatter; only the thread's own replies.
          if (item === null || item.parentToolCallId) continue;
          const text = toSpeech(item.text);
          if (text !== "") messages.push({ id: `${threadId}:${item.id}`, text });
        }
        if (rows.length < 100) break;
      }
      cursors.set(threadId, cursor);
      for (const message of messages) {
        const payload: SpeakPayload = { threadId, ...message };
        bb.realtime.publish(CHANNEL_SPEAK, payload);
      }
    });
  }

  /** Newest top-level assistant message, as speakable text. */
  async function lastMessage(threadId: string): Promise<SpeakPayload | null> {
    const rows = await bb.sdk.threads.events.list({
      threadId,
      order: "desc",
      types: ["item/completed"],
      limit: "50",
    });
    for (const row of rows) {
      const item = agentMessageOf(row.data);
      if (item === null || item.parentToolCallId) continue;
      const text = toSpeech(item.text);
      if (text !== "") return { threadId, id: `${threadId}:${item.id}`, text };
    }
    return null;
  }

  async function setEnabled(threadId: string, on: boolean) {
    if (on) {
      enabled.add(threadId);
      cursors.set(threadId, await latestSeq(threadId));
    } else {
      enabled.delete(threadId);
      cursors.delete(threadId);
    }
    await saveEnabled();
    const payload: StatePayload = { threadId, enabled: on };
    bb.realtime.publish(CHANNEL_STATE, payload);
    return on;
  }

  bb.events.on("experimental_thread.events", ({ thread }) => {
    if (enabled.has(thread.id)) void drain(thread.id);
  });
  bb.events.on("thread.idle", ({ thread }) => {
    if (!enabled.has(thread.id)) return;
    void drain(thread.id).then(() =>
      serialize(thread.id, async () => {
        const last = await lastMessage(thread.id);
        if (last !== null) bb.realtime.publish(CHANNEL_DONE, last);
      }),
    );
  });
  // Deleted threads drop out; archived ones keep their setting.
  bb.events.on("thread.deleted", ({ thread }) => {
    if (enabled.has(thread.id)) void setEnabled(thread.id, false);
  });

  // Seed cursors so the first notification after a reload doesn't replay.
  for (const threadId of enabled) {
    void serialize(threadId, async () => {
      cursors.set(threadId, await latestSeq(threadId));
    });
  }

  bb.rpc.register(rpcContract, {
    state: ({ threadId }) => ({ enabled: enabled.has(threadId) }),
    set_enabled: async ({ threadId, enabled: on }) => ({
      enabled: await setEnabled(threadId, on),
    }),
    enabled_threads: () => ({ threadIds: [...enabled] }),
    last_message: async ({ threadId }) => ({
      text: (await lastMessage(threadId))?.text ?? null,
    }),
  });

  bb.cli.register({
    name: "read-aloud",
    summary: "Turn read-aloud on or off for a thread",
    commands: [
      { name: "status", summary: "List threads with read-aloud on", usage: "bb read-aloud status" },
      { name: "on", summary: "Turn read-aloud on", usage: "bb read-aloud on <thread-id>" },
      { name: "off", summary: "Turn read-aloud off", usage: "bb read-aloud off <thread-id>" },
    ],
    async run(argv) {
      const [command, threadId] = argv;
      const usage = "Usage:\n  bb read-aloud status\n  bb read-aloud on <thread-id>\n  bb read-aloud off <thread-id>";
      if (command === "status") {
        return {
          exitCode: 0,
          stdout: enabled.size === 0 ? "Read-aloud is off everywhere." : [...enabled].join("\n"),
        };
      }
      if ((command === "on" || command === "off") && threadId) {
        await setEnabled(threadId, command === "on");
        return { exitCode: 0, stdout: `Read-aloud ${command} for ${threadId}` };
      }
      return { exitCode: command === undefined || command === "help" ? 0 : 1, stdout: usage };
    },
  });

  bb.onDispose(() => {
    disposed = true;
  });
}
