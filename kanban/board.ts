// The board file. It keeps the format of the standalone `kb` board
// ({ lanes: [{id, name}], items: [{id, title, note, lane, created, updated}] })
// and its `<file>.lock` protocol, so `kb` and this plugin can share one file.
// Statuses are fixed; every write stores the six canonical lanes.
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { STATUSES, STATUS_NAMES, type Item, type Status } from "./statuses";

export * from "./statuses";

interface Board {
  lanes: { id: string; name: string }[];
  items: Item[];
}

// Other spellings, including the kb starter lanes ("doing-now").
const ALIASES: Record<string, Status> = {
  todo: "to-do",
  doingnow: "doing",
  inprogress: "doing",
  wip: "doing",
  archive: "archived",
};

const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

// Exact id, name or alias only; used for stored lanes.
function exactStatus(ref: string): Status | null {
  const q = squash(ref);
  return STATUSES.find((s) => squash(s) === q) ?? ALIASES[q] ?? null;
}

/** Resolve a status by id, name, alias or unique prefix; null when unknown. */
export function matchStatus(ref: string): Status | null {
  const q = squash(ref);
  if (q === "") return null;
  const exact = exactStatus(ref);
  if (exact) return exact;
  const prefixed = STATUSES.filter((s) => squash(s).startsWith(q));
  return prefixed.length === 1 ? prefixed[0] : null;
}

export function parseStatus(ref: string): Status {
  const status = matchStatus(ref);
  if (status === null) throw new Error(`unknown status: ${ref} (use ${STATUSES.join(", ")})`);
  return status;
}

const now = () => new Date().toISOString();

// Refuse anything that isn't a board instead of rewriting it: a write would
// replace the file. kb starter lanes map to their status ("doing-now" ->
// doing); an item in any other lane is an error. Unknown fields are kept.
function normalize(raw: unknown): Board {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("board file is not a JSON object");
  const board = raw as Partial<Board>;
  if (board.items !== undefined && !Array.isArray(board.items)) throw new Error("board file: items is not an array");
  return {
    ...board,
    lanes: STATUSES.map((id) => ({ id, name: STATUS_NAMES[id] })),
    items: (board.items ?? []).map((i, n) => {
      if (!i || typeof i.id !== "string") throw new Error(`board file: item ${n} has no id`);
      const lane = exactStatus(String(i.lane ?? ""));
      if (lane === null) throw new Error(`board file: item ${i.id} has unknown status "${i.lane}"`);
      return {
        ...i,
        title: String(i.title ?? ""),
        note: String(i.note ?? ""),
        lane,
        created: String(i.created ?? now()),
        updated: String(i.updated ?? i.created ?? now()),
      };
    }),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createBoard(file: string, onChange: () => void = () => {}) {
  async function read(): Promise<Board> {
    try {
      return normalize(JSON.parse(await readFile(file, "utf8")));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return normalize({});
      throw e;
    }
  }

  // Same lock as kb: create `<file>.lock` exclusively, break it after 3s.
  async function lock(): Promise<() => Promise<void>> {
    const lockFile = `${file}.lock`;
    await mkdir(dirname(file), { recursive: true });
    const start = Date.now();
    for (;;) {
      try {
        await (await open(lockFile, "wx")).close();
        return () => unlink(lockFile).catch(() => {});
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        const age = await stat(lockFile).then((s) => Date.now() - s.mtimeMs, () => 0);
        if (age > 3000) {
          await unlink(lockFile).catch(() => {});
          continue;
        }
        if (Date.now() - start > 3000) throw new Error("board is busy");
        await sleep(10);
      }
    }
  }

  async function mutate<T>(fn: (board: Board) => T): Promise<T> {
    const unlock = await lock();
    try {
      const board = await read();
      const out = fn(board);
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(board, null, 2));
      await rename(tmp, file);
      onChange();
      return out;
    } finally {
      await unlock();
    }
  }

  function find(board: Board, id: string): Item {
    const hits = board.items.filter((i) => i.id === id || (id.length >= 2 && i.id.startsWith(id)));
    if (hits.length !== 1) throw new Error(hits.length ? `ambiguous id: ${id}` : `no item: ${id}`);
    return hits[0];
  }

  const cleanTitle = (title: string) => {
    const t = title.trim();
    if (!t) throw new Error("title required");
    return t;
  };

  return {
    file,
    async list(): Promise<Item[]> {
      return (await read()).items;
    },
    async get(id: string): Promise<Item> {
      return find(await read(), id);
    },
    async add(input: { title: string; note?: string; status?: Status }): Promise<Item> {
      const title = cleanTitle(input.title);
      return mutate((board) => {
        let id = randomBytes(3).toString("hex");
        while (board.items.some((i) => i.id === id)) id = randomBytes(3).toString("hex");
        const item: Item = { id, title, note: input.note ?? "", lane: input.status ?? "backlog", created: now(), updated: now() };
        board.items.push(item);
        return item;
      });
    },
    async update(id: string, patch: { title?: string; note?: string; status?: Status }): Promise<Item> {
      const title = patch.title === undefined ? undefined : cleanTitle(patch.title);
      return mutate((board) => {
        const item = find(board, id);
        if (title !== undefined) item.title = title;
        if (patch.note !== undefined) item.note = patch.note;
        if (patch.status !== undefined) item.lane = patch.status;
        item.updated = now();
        return item;
      });
    },
    async remove(id: string): Promise<Item> {
      return mutate((board) => {
        const item = find(board, id);
        board.items = board.items.filter((i) => i !== item);
        return item;
      });
    },
  };
}

export type BoardStore = ReturnType<typeof createBoard>;
