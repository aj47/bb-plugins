// Kanban: one board for all work in progress. The board page (app.tsx, over
// RPC), the `bb kanban` command, and the standalone `kb` tool all read and
// write the same JSON file (board.ts). Any write, from here or from outside,
// publishes "board-changed" so open pages refetch.
import { mkdirSync, watch } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import {
  PluginCliError,
  cliCommand,
  defineCli,
  defineRpcContract,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { CLOSED, STATUSES, STATUS_NAMES, createBoard, parseStatus, type Item } from "./board";

const DEFAULT_FILE = "~/Documents/admin/kanban/board.json";

const statusSchema = z.enum(STATUSES);
const itemSchema = z.object({
  id: z.string(),
  title: z.string(),
  note: z.string(),
  lane: statusSchema,
  created: z.string(),
  updated: z.string(),
});

export const rpcContract = defineRpcContract({
  board_get: {
    input: z.null(),
    output: z.object({ file: z.string(), items: z.array(itemSchema) }),
  },
  item_add: {
    input: z.object({
      title: z.string().trim().min(1).max(300),
      note: z.string().max(20_000).optional(),
      status: statusSchema.optional(),
    }),
    output: itemSchema,
  },
  item_update: {
    input: z.object({
      id: z.string().min(1),
      title: z.string().trim().min(1).max(300).optional(),
      note: z.string().max(20_000).optional(),
      status: statusSchema.optional(),
    }),
    output: itemSchema,
  },
  item_remove: {
    input: z.object({ id: z.string().min(1) }),
    output: itemSchema,
  },
});

const BOARD_CHANGED = "board-changed";

const expandHome = (p: string) => resolve(p.replace(/^~(?=$|\/)/, homedir()));

const line = (i: Item) => `${i.id}  ${i.lane}  ${i.title}${i.note ? " (+note)" : ""}`;
const byStatus = (a: Item, b: Item) => STATUSES.indexOf(a.lane) - STATUSES.indexOf(b.lane);

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    boardFile: {
      type: "string",
      label: "Board file",
      description: `JSON file that holds the board. Point the standalone kb tool at it with KB_DATA. Default ${DEFAULT_FILE}. Reload the plugin after changing it.`,
      default: DEFAULT_FILE,
    },
  });
  const { boardFile } = await settings.get();
  const file = expandHome(String(boardFile || DEFAULT_FILE));

  const publish = () => bb.realtime.publish(BOARD_CHANGED, {});
  const board = createBoard(file, publish);

  // Writes from kb or a text editor land in the file directly; watch it.
  mkdirSync(dirname(file), { recursive: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watcher = watch(dirname(file), (_event, name) => {
    if (name !== basename(file)) return;
    clearTimeout(timer);
    timer = setTimeout(publish, 150);
  });
  bb.onDispose(() => {
    clearTimeout(timer);
    watcher.close();
  });

  bb.rpc.register(rpcContract, {
    board_get: async () => ({ file, items: await board.list() }),
    item_add: (input) => board.add(input),
    item_update: ({ id, ...patch }) => board.update(id, patch),
    item_remove: ({ id }) => board.remove(id),
  });

  // Store errors (unknown id, bad status) become CLI errors with a hint.
  const cliError = (e: unknown) =>
    new PluginCliError(e instanceof Error ? e.message : String(e), {
      code: "kanban_error",
      hint: "Run `bb kanban ls --all` to see ids, `bb kanban statuses` for statuses.",
    });
  const attempt = async <T>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      throw cliError(e);
    }
  };
  const status = (ref: string | undefined) => {
    if (ref === undefined) return undefined;
    try {
      return parseStatus(ref);
    } catch (e) {
      throw cliError(e);
    }
  };
  const reply = (json: boolean, value: unknown, text: string) => ({
    exitCode: 0,
    stdout: json ? JSON.stringify(value) : text,
  });

  const json = { type: "boolean", description: "Print JSON" } as const;
  const statusList = STATUSES.join(", ");
  const idArg = { name: "id", description: "Item id or unique prefix", required: true } as const;

  bb.cli.register(
    defineCli({
      name: "kanban",
      summary: "Track work on the shared Kanban board",
      description: `Statuses: ${statusList}. Ids accept unique prefixes; statuses accept names and prefixes (todo = to-do).`,
      commands: {
        ls: cliCommand({
          summary: "List items, one per line: id status title",
          aliases: ["list"],
          positionals: [{ name: "status", description: "Only this status" }],
          options: {
            all: { type: "boolean", description: "Include done and archived" },
            json,
          },
          async run({ positionals, options }) {
            const only = status(positionals.status);
            const items = (await board.list())
              .filter((i) => (only ? i.lane === only : options.all || !CLOSED.includes(i.lane)))
              .sort(byStatus);
            return reply(options.json, items, items.length ? items.map(line).join("\n") : "(none)");
          },
        }),
        add: cliCommand({
          summary: "Add an item (default status: backlog)",
          positionals: [{ name: "title", description: "Item title", required: true, variadic: true }],
          options: {
            status: { type: "string", short: "s", aliases: ["lane"], description: `One of ${statusList}` },
            note: { type: "string", short: "n", description: "Details, links, thread refs" },
            json,
          },
          async run({ positionals, options }) {
            const item = await attempt(() =>
              board.add({ title: positionals.title.join(" "), note: options.note, status: status(options.status) }),
            );
            return reply(options.json, item, line(item));
          },
        }),
        mv: cliCommand({
          summary: "Move an item to a status",
          aliases: ["move"],
          positionals: [idArg, { name: "status", description: `One of ${statusList}`, required: true }],
          options: { json },
          async run({ positionals, options }) {
            const item = await attempt(() => board.update(positionals.id, { status: status(positionals.status) }));
            return reply(options.json, item, line(item));
          },
        }),
        set: cliCommand({
          summary: "Change an item's title, note or status",
          aliases: ["update"],
          positionals: [idArg],
          options: {
            title: { type: "string", short: "t", description: "New title" },
            note: { type: "string", short: "n", description: "New note (replaces the old one)" },
            status: { type: "string", short: "s", aliases: ["lane"], description: `One of ${statusList}` },
            json,
          },
          constraints: [{ kind: "at-least-one", options: ["title", "note", "status"] }],
          async run({ positionals, options }) {
            const item = await attempt(() =>
              board.update(positionals.id, { title: options.title, note: options.note, status: status(options.status) }),
            );
            return reply(options.json, item, line(item));
          },
        }),
        show: cliCommand({
          summary: "Show one item as JSON, note included",
          positionals: [idArg],
          async run({ positionals }) {
            const item = await attempt(() => board.get(positionals.id));
            return { exitCode: 0, stdout: JSON.stringify(item, null, 2) };
          },
        }),
        rm: cliCommand({
          summary: "Delete an item (prefer `mv <id> archived`)",
          aliases: ["remove"],
          positionals: [idArg],
          options: { json },
          async run({ positionals, options }) {
            const item = await attempt(() => board.remove(positionals.id));
            return reply(options.json, item, `removed ${item.id}`);
          },
        }),
        statuses: cliCommand({
          summary: "List statuses with item counts",
          options: { json },
          async run({ options }) {
            const items = await board.list();
            const rows = STATUSES.map((id) => ({
              id,
              name: STATUS_NAMES[id],
              count: items.filter((i) => i.lane === id).length,
            }));
            return reply(options.json, rows, rows.map((r) => `${r.id}  (${r.count})`).join("\n"));
          },
        }),
        path: cliCommand({
          summary: "Print the board file path",
          async run() {
            return { exitCode: 0, stdout: file };
          },
        }),
      },
    }),
  );
}
