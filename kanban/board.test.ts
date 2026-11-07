import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STATUSES, createBoard, matchStatus } from "./board.ts";
import { cardThreads } from "./statuses.ts";
import { good, PROMPT } from "./fixtures.ts";

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kanban-"));
  file = join(dir, "board.json");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("statuses", () => {
  it("are exactly the six", () => {
    expect(STATUSES).toEqual(["needs-you", "backlog", "to-do", "doing", "done", "blocked", "archived"]);
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
    const item = await board.add(good({ title: "  Ship it ", note: "n" }));
    expect(item).toMatchObject({ title: "Ship it", note: "n", lane: "to-do" });
    expect((await board.update(item.id.slice(0, 3), { status: "blocked", waitsOn: "the logo", note: "waiting" })).lane).toBe("blocked");
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
    await expect(board.add(good({ title: "  " }))).rejects.toThrow("title required");
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
    await board.add(good({ title: "New" }));
    const saved = JSON.parse(await readFile(file, "utf8"));
    expect(saved.extra).toBe(1);
    expect(saved.items[0]).toMatchObject({ id: "abc123", lane: "doing", tag: "x" });
  });

  it("refuses files it would damage and leaves them untouched", async () => {
    for (const content of ["{not json", "[]", '{"items":{}}', '{"items":[{"title":"no id"}]}', '{"items":[{"id":"a","lane":"review"}]}']) {
      await writeFile(file, content);
      const board = createBoard(file);
      await expect(board.add(good())).rejects.toThrow();
      expect(await readFile(file, "utf8")).toBe(content);
    }
  });

  it("serializes concurrent writes", async () => {
    const a = createBoard(file);
    const b = createBoard(file);
    await Promise.all(Array.from({ length: 20 }, (_, n) => (n % 2 ? a : b).add(good({ title: `item ${n}` }))));
    expect(await a.list()).toHaveLength(20);
  });

  it("refuses cards that break the rules, listing every problem", async () => {
    const board = createBoard(file);
    const err = await board.add({ title: "Decide: thr_abc123 [video] " + "x".repeat(60), status: "needs-you", actions: [{ label: "Go", prompt: "short" }] }).catch((e) => e);
    for (const p of ["max 60", '"Decide:"', "[tag]", "id", "why is required", "tags", "min 200", "Done when", "2 to 4 actions", "exactly one action recommended"])
      expect(err.message).toContain(p);
    await expect(board.add(good({ status: "blocked" }))).rejects.toThrow("waitsOn");
    await expect(board.add(good({ actions: [] }))).rejects.toThrow("1 to 3 actions");
    const two = [
      { label: "A", prompt: PROMPT, recommended: true },
      { label: "Let it go", archive: true },
    ];
    expect((await board.add(good({ status: "needs-you", actions: two }))).lane).toBe("needs-you");
  });

  it("lets old cards close or take notes, but not move to an open status", async () => {
    await writeFile(file, JSON.stringify({ items: [{ id: "abc123", title: "Old", note: "", lane: "backlog", created: "t", updated: "t" }] }));
    const board = createBoard(file);
    expect((await board.update("abc123", { note: "seen" })).note).toBe("seen");
    await expect(board.update("abc123", { status: "to-do" })).rejects.toThrow("card refused");
    expect((await board.update("abc123", { status: "archived" })).lane).toBe("archived");
  });
});

describe("cardThreads", () => {
  const card = { note: "" };

  it("is empty for a card with no threads", () => {
    expect(cardThreads({ note: "see card 35924d, about thr_1" })).toEqual([]);
  });

  it("puts started threads first, then the note's newest mention, then why and prompts", () => {
    const threads = cardThreads({
      threads: ["thr_started1", "thr_started2"],
      note: "From @thread:thr_noteold1. Later (thr_notenew1).",
      why: "See thr_whythere",
      actions: [{ label: "Go", prompt: "Read @thread:thr_prompt01 and /workspaces/thr_prompt02/out.md." }],
    });
    expect(threads).toEqual(["thr_started2", "thr_started1", "thr_notenew1", "thr_noteold1", "thr_whythere", "thr_prompt01", "thr_prompt02"]);
  });

  it("lists a thread once", () => {
    expect(cardThreads({ ...card, threads: ["thr_abcdef12"], note: "thr_abcdef12 thr_abcdef12" })).toEqual(["thr_abcdef12"]);
  });
});
