import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STATUSES, createBoard, matchStatus } from "./board.ts";

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kanban-"));
  file = join(dir, "board.json");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("statuses", () => {
  it("are exactly the six", () => {
    expect(STATUSES).toEqual(["backlog", "to-do", "doing", "done", "blocked", "archived"]);
  });

  it("match ids, names, aliases and unique prefixes", () => {
    expect(matchStatus("todo")).toBe("to-do");
    expect(matchStatus("To Do")).toBe("to-do");
    expect(matchStatus("Doing Now")).toBe("doing");
    expect(matchStatus("wip")).toBe("doing");
    expect(matchStatus("arch")).toBe("archived");
    expect(matchStatus("bl")).toBe("blocked");
    expect(matchStatus("b")).toBe(null); // backlog or blocked
    expect(matchStatus("do")).toBe(null); // doing or done
    expect(matchStatus("nope")).toBe(null);
  });
});

describe("board", () => {
  it("starts empty without creating the file", async () => {
    expect(await createBoard(file).list()).toEqual([]);
    await expect(readFile(file)).rejects.toThrow();
  });

  it("adds, edits, moves and removes items", async () => {
    let changes = 0;
    const board = createBoard(file, () => changes++);
    const item = await board.add({ title: "  Ship it ", note: "n" });
    expect(item).toMatchObject({ title: "Ship it", note: "n", lane: "backlog" });
    expect((await board.update(item.id.slice(0, 3), { status: "blocked", note: "waiting" })).lane).toBe("blocked");
    expect((await board.update(item.id, { title: "Ship" })).title).toBe("Ship");
    expect(await board.get(item.id)).toMatchObject({ title: "Ship", note: "waiting", lane: "blocked" });
    await board.remove(item.id);
    expect(await board.list()).toEqual([]);
    expect(changes).toBe(4);
    const saved = JSON.parse(await readFile(file, "utf8"));
    expect(saved.lanes.map((l: { id: string }) => l.id)).toEqual([...STATUSES]);
  });

  it("rejects empty titles and unknown ids", async () => {
    const board = createBoard(file);
    await expect(board.add({ title: "  " })).rejects.toThrow("title required");
    await expect(board.update("zz", { title: "x" })).rejects.toThrow("no item: zz");
  });

  it("reads kb boards and keeps unknown fields", async () => {
    const kb = {
      lanes: [{ id: "doing-now", name: "Doing Now" }],
      extra: 1,
      items: [{ id: "abc123", title: "Old", note: "", lane: "doing-now", created: "t", updated: "t", tag: "x" }],
    };
    await writeFile(file, JSON.stringify(kb));
    const board = createBoard(file);
    expect((await board.list())[0].lane).toBe("doing");
    await board.add({ title: "New" });
    const saved = JSON.parse(await readFile(file, "utf8"));
    expect(saved.extra).toBe(1);
    expect(saved.items[0]).toMatchObject({ id: "abc123", lane: "doing", tag: "x" });
  });

  it("refuses files it would damage and leaves them untouched", async () => {
    for (const content of ["{not json", "[]", '{"items":{}}', '{"items":[{"title":"no id"}]}', '{"items":[{"id":"a","lane":"review"}]}']) {
      await writeFile(file, content);
      const board = createBoard(file);
      await expect(board.add({ title: "x" })).rejects.toThrow();
      expect(await readFile(file, "utf8")).toBe(content);
    }
  });

  it("serializes concurrent writes", async () => {
    const a = createBoard(file);
    const b = createBoard(file);
    await Promise.all(Array.from({ length: 20 }, (_, n) => (n % 2 ? a : b).add({ title: `item ${n}` })));
    expect(await a.list()).toHaveLength(20);
  });
});
