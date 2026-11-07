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
import { CLOSED, STATUSES, STATUS_NAMES, createBoard, parseStatus, type CardInput, type Item } from "./board";
import { createCards } from "./cards";
import { LIMITS, cardProblems } from "./rules";

const DEFAULT_FILE = "~/Documents/admin/kanban/board.json";

const statusSchema = z.enum(STATUSES);
const actionSchema = z.object({
  label: z.string(),
  prompt: z.string().optional(),
  project: z.string().optional(),
  recommended: z.boolean().optional(),
  archive: z.boolean().optional(),
});
const itemSchema = z.object({
  id: z.string(),
  title: z.string(),
  why: z.string().optional(),
  tags: z.array(z.string()).optional(),
  actions: z.array(actionSchema).optional(),
  waitsOn: z.string().optional(),
  threads: z.array(z.string()).optional(),
  note: z.string(),
  lane: statusSchema,
  created: z.string(),
  updated: z.string(),
});
const patchSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  why: z.string().max(2000).optional(),
  tags: z.array(z.string()).max(20).optional(),
  actions: z.array(actionSchema).max(10).optional(),
  waitsOn: z.string().max(2000).optional(),
  note: z.string().max(20_000).optional(),
  status: statusSchema.optional(),
});

export const rpcContract = defineRpcContract({
  board_get: {
    input: z.null(),
    output: z.object({ file: z.string(), items: z.array(itemSchema) }),
  },
  item_add: {
    input: z.object({ title: z.string().trim().min(1).max(300), status: statusSchema.optional() }),
    output: itemSchema,
  },
  item_update: {
    input: patchSchema.extend({ id: z.string().min(1) }),
    output: itemSchema,
  },
  item_run: {
    input: z.object({ id: z.string().min(1), action: z.number().int().min(0) }),
    output: z.object({ item: itemSchema, threadId: z.string().optional() }),
  },
  item_run_custom: {
    input: z.object({ id: z.string().min(1), text: z.string().trim().min(1).max(5000) }),
    output: z.object({ item: itemSchema, threadId: z.string() }),
  },
  item_remove: {
    input: z.object({ id: z.string().min(1) }),
    output: itemSchema,
  },
});

const BOARD_CHANGED = "board-changed";

const expandHome = (p: string) => resolve(p.replace(/^~(?=$|\/)/, homedir()));

const line = (i: Item) => `${i.id}  ${i.lane}  ${i.title}${i.tags?.length ? `  #${i.tags.join(" #")}` : ""}`;
const byStatus = (a: Item, b: Item) => STATUSES.indexOf(a.lane) - STATUSES.indexOf(b.lane);

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    boardFile: {
      type: "string",
      label: "Board file",
      description: `JSON file that holds the board. Point the standalone kb tool at it with KB_DATA. Default ${DEFAULT_FILE}. Reload the plugin after changing it.`,
      default: DEFAULT_FILE,
    },
    defaultProject: {
      type: "string",
      label: "Default project",
      description: "bb project id that threads started from a card use when the action names none.",
      default: "proj_personal",
    },
  });
  const { boardFile, defaultProject } = await settings.get();
  const file = expandHome(String(boardFile || DEFAULT_FILE));

  const publish = () => bb.realtime.publish(BOARD_CHANGED, {});
  const board = createBoard(file, publish);
  const cards = createCards(board, async ({ project, title, prompt }) => {
    const thread = (await bb.sdk.threads.spawn({
      projectId: project || String(defaultProject || "proj_personal"),
      environment: { type: "project-default" },
      title: title.slice(0, 70),
      prompt,
    } as never)) as unknown as { id: string };
    return thread.id;
  });

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
    item_add: ({ title, status }) => cards.quickAdd(title, status),
    item_update: ({ id, ...patch }) => cards.edit(id, patch),
    item_run: ({ id, action }) => cards.run(id, action),
    item_run_custom: ({ id, text }) => cards.runCustom(id, text),
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
  const today = () => new Date().toISOString().slice(0, 10);

  const SPEC_HELP = `Card JSON: {"title","why","tags":[..],"actions":[{"label","prompt","recommended"?,"project"?,"archive"?}],"waitsOn"?,"note"?,"status"?}. Rules: title <= ${LIMITS.title} chars with no "Decide:"-style prefix, [tags] or ids; why one line <= ${LIMITS.why}; 1-${LIMITS.tags} lowercase tags; each prompt >= ${LIMITS.promptMin} chars, self-contained, with a "Done when:" line; needs-you has 2-4 actions with exactly one recommended; blocked needs waitsOn; other open cards need 1-3 actions.`;
  const cardOptions = {
    spec: { type: "string", stdin: true, description: `Card fields as JSON (use --spec-stdin with a heredoc). ${SPEC_HELP}` },
    title: { type: "string", short: "t", description: `Title, <= ${LIMITS.title} chars` },
    why: { type: "string", short: "w", description: `One line on why it matters, <= ${LIMITS.why} chars` },
    tag: { type: "string", repeatable: true, split: ",", description: "Tags, comma-separated or repeated" },
    "waits-on": { type: "string", description: "What a blocked card waits on" },
    note: { type: "string", short: "n", description: "Extra context shown when the card is opened (replaces the old note)" },
    status: { type: "string", short: "s", aliases: ["lane"], description: `One of ${statusList}` },
    json,
  } as const;

  const readCard = (options: Record<string, unknown>): CardInput => {
    let spec: Record<string, unknown> = {};
    if (typeof options.spec === "string") {
      try {
        spec = JSON.parse(options.spec);
      } catch (e) {
        throw new PluginCliError(`--spec is not valid JSON: ${(e as Error).message}`, { code: "kanban_error" });
      }
    }
    const pick = <T>(flag: unknown, key: string) => (flag !== undefined ? flag : spec[key]) as T | undefined;
    const tags = options.tag as string[] | undefined;
    return {
      title: pick<string>(options.title, "title"),
      why: pick<string>(options.why, "why"),
      tags: tags && tags.length ? tags : (spec.tags as string[] | undefined),
      actions: spec.actions as CardInput["actions"],
      waitsOn: pick<string>(options["waits-on"], "waitsOn"),
      note: pick<string>(options.note, "note"),
      status: status(pick<string>(options.status, "status") ?? (spec.lane as string | undefined)),
    };
  };
  const ids = { name: "ids", description: "Item ids or unique prefixes", required: true, variadic: true } as const;

  bb.cli.register(
    defineCli({
      name: "kanban",
      summary: "Track work on the shared Kanban board",
      description: `Statuses: ${statusList}. Ids accept unique prefixes. Cards are checked on every write and refused with the list of problems. ${SPEC_HELP}`,
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
          summary: "Add a card; it must pass the card rules",
          positionals: [{ name: "title", description: "Title (or give it in --spec)", variadic: true }],
          options: cardOptions,
          async run({ positionals, options }) {
            const card = readCard(options);
            const title = positionals.title?.length ? positionals.title.join(" ") : card.title;
            if (!title) throw new PluginCliError("title required", { code: "kanban_error" });
            const item = await attempt(() => board.add({ ...card, title }));
            return reply(options.json, item, line(item));
          },
        }),
        set: cliCommand({
          summary: "Change a card's fields; the result must pass the card rules",
          aliases: ["update"],
          positionals: [idArg],
          options: cardOptions,
          async run({ positionals, options }) {
            const patch = Object.fromEntries(Object.entries(readCard(options)).filter(([, v]) => v !== undefined)) as CardInput;
            if (Object.keys(patch).length === 0)
              throw new PluginCliError("nothing to change", { code: "kanban_error", hint: "Give --spec or a field flag." });
            const item = await attempt(() => board.update(positionals.id, patch));
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
        run: cliCommand({
          summary: "Run a card's action: start its thread (card moves to doing) or archive",
          positionals: [idArg, { name: "action", description: "Action number, from 1 (default: the recommended or first)" }],
          options: {
            prompt: { type: "string", short: "p", stdin: true, description: "Your own instruction instead of an action; the card's context is attached" },
            json,
          },
          async run({ positionals, options }) {
            const result = await attempt(async () => {
              if (options.prompt) return cards.runCustom(positionals.id, options.prompt);
              const item = await board.get(positionals.id);
              const n = positionals.action
                ? Number(positionals.action) - 1
                : Math.max(0, item.actions?.findIndex((a) => a.recommended) ?? 0);
              return cards.run(item.id, n);
            });
            return reply(options.json, result, result.threadId ? `started ${result.threadId}\n${line(result.item)}` : line(result.item));
          },
        }),
        done: cliCommand({
          summary: "Mark one or more items done",
          aliases: ["finish"],
          positionals: [ids],
          options: {
            result: { type: "string", short: "r", description: "One line on what changed and where; added to the note" },
            json,
          },
          async run({ positionals, options }) {
            const items = await attempt(async () => {
              const out: Item[] = [];
              for (const id of positionals.ids) {
                const note = options.result ? `${(await board.get(id)).note.trimEnd()}\n${today()} done: ${options.result}`.trim() : undefined;
                out.push(await board.update(id, { status: "done", ...(note ? { note } : {}) }));
              }
              return out;
            });
            return reply(options.json, items, items.map(line).join("\n"));
          },
        }),
        archive: cliCommand({
          summary: "Archive one or more items, or every done item with --done",
          positionals: [{ name: "ids", description: "Item ids or unique prefixes", variadic: true }],
          options: {
            done: { type: "boolean", description: "Archive every item in done" },
            json,
          },
          async run({ positionals, options }) {
            const items = await attempt(async () => {
              const list = [...(positionals.ids ?? [])];
              if (options.done) list.push(...(await board.list()).filter((i) => i.lane === "done").map((i) => i.id));
              if (list.length === 0) throw new Error("give item ids, or --done to archive everything in done");
              const out: Item[] = [];
              for (const id of new Set(list)) out.push(await board.update(id, { status: "archived" }));
              return out;
            });
            return reply(options.json, items, items.map(line).join("\n"));
          },
        }),
        lint: cliCommand({
          summary: "List open cards that break the card rules",
          options: { json },
          async run({ options }) {
            const bad = (await board.list())
              .map((i) => ({ id: i.id, title: i.title, lane: i.lane, problems: cardProblems(i) }))
              .filter((r) => r.problems.length);
            const text = bad.length ? bad.map((r) => `${r.id}  ${r.lane}  ${r.title}\n  - ${r.problems.join("\n  - ")}`).join("\n") : "all open cards pass";
            return reply(options.json, bad, text);
          },
        }),
        show: cliCommand({
          summary: "Show one item as JSON",
          positionals: [idArg],
          async run({ positionals }) {
            const item = await attempt(() => board.get(positionals.id));
            return { exitCode: 0, stdout: JSON.stringify(item, null, 2) };
          },
        }),
        rm: cliCommand({
          summary: "Delete an item (prefer `archive`)",
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
