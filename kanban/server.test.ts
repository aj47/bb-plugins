import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import plugin from "./server.ts";
import { PROMPT, good } from "./fixtures.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kanban-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

async function load() {
  const spawned: unknown[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "kanban",
    settings: { boardFile: join(dir, "board.json") },
  });
  harness.sdk.stub("threads.spawn", async (a: never) => {
    spawned.push(a);
    return { id: `thr_new${spawned.length}` };
  });
  await plugin(bb);
  const cli = (...argv: string[]) => harness.behavior.runCli(argv);
  const spec = (over = {}) => JSON.stringify(good(over));
  return { harness, cli, spec, spawned };
}

describe("bb kanban", () => {
  it("marks done and archives in bulk", async () => {
    const { cli, spec } = await load();
    const a = JSON.parse((await cli("add", "One", "--spec", spec(), "--json")).stdout);
    const b = JSON.parse((await cli("add", "Two", "--spec", spec(), "--json")).stdout);
    const c = JSON.parse((await cli("add", "Three", "--spec", spec(), "--json")).stdout);
    expect((await cli("done", a.id, b.id, "-r", "shipped")).stdout).toBe(`${a.id}  done  One  #docs\n${b.id}  done  Two  #docs`);
    expect(JSON.parse((await cli("show", a.id)).stdout).note).toMatch(/done: shipped$/);
    expect((await cli("archive", c.id)).stdout).toBe(`${c.id}  archived  Three  #docs`);
    expect((await cli("archive", "--done")).stdout.split("\n")).toHaveLength(2);
    expect((await cli("archive")).exitCode).not.toBe(0);
  });

  it("runs the user's own instruction with the card's context", async () => {
    const { cli, spawned } = await load();
    const spec = JSON.stringify(good({ status: "needs-you", note: "the note", actions: [{ label: "Do A", prompt: PROMPT, recommended: true }, { label: "Skip", archive: true }] }));
    const card = JSON.parse((await cli("add", "--spec", spec, "--json")).stdout);
    expect((await cli("run", card.id, "-p", "Only do the README part")).stdout).toContain("started thr_new1");
    const prompt = (spawned[0] as { prompt: string }).prompt;
    expect(prompt.startsWith("Only do the README part")).toBe(true);
    for (const part of ["Why: New users", "the note", "Suggested action 1 (Do A)", `bb kanban done ${card.id}`]) expect(prompt).toContain(part);
    const after = JSON.parse((await cli("show", card.id)).stdout);
    expect(after).toMatchObject({ lane: "doing", actions: [{ label: "Only do the README part" }] });
    expect(after.note).toContain('chose "Only do the README part"');
  });

  it("refuses a bad card and lints old ones", async () => {
    const { cli } = await load();
    const bad = await cli("add", "Decide: something");
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr).toContain("why is required");
    expect((await cli("lint")).stdout).toBe("all open cards pass");
  });

  it("runs an action: starts a thread with the prompt and moves the card to doing", async () => {
    const { cli, spawned } = await load();
    const spec = JSON.stringify(good({ status: "needs-you", actions: [{ label: "Do A", prompt: PROMPT }, { label: "Do B", prompt: PROMPT, recommended: true }] }));
    const card = JSON.parse((await cli("add", "--spec", spec, "--json")).stdout);
    const out = await cli("run", card.id);
    expect(out.stdout).toContain("started thr_new1");
    expect(spawned[0]).toMatchObject({ projectId: "proj_personal", title: "Write the docs" });
    expect((spawned[0] as { prompt: string }).prompt).toContain(`bb kanban done ${card.id}`);
    const after = JSON.parse((await cli("show", card.id)).stdout);
    expect(after).toMatchObject({ lane: "doing", threads: ["thr_new1"], actions: [{ label: "Do B" }] });
    expect(after.note).toContain('chose "Do B"');
  });

  it("creates, lists, shows, edits, moves and deletes", async () => {
    const { harness, cli } = await load();
    const added = await cli("add", "Write", "the", "docs", "--spec", JSON.stringify(good()), "-s", "todo", "-n", "see thr_1", "--json");
    expect(added.exitCode).toBe(0);
    const item = JSON.parse(added.stdout);
    expect(item).toMatchObject({ title: "Write the docs", lane: "to-do", note: "see thr_1" });

    expect((await cli("ls")).stdout).toBe(`${item.id}  to-do  Write the docs  #docs`);
    expect((await cli("mv", item.id, "blocked")).stderr).toContain("waitsOn");
    expect((await cli("set", item.id, "-s", "blocked", "--waits-on", "the logo")).stdout).toContain("blocked");
    expect((await cli("set", item.id, "-t", "Write docs", "-s", "doing")).stdout).toBe(`${item.id}  doing  Write docs  #docs`);
    expect(JSON.parse((await cli("show", item.id)).stdout)).toMatchObject({ title: "Write docs", note: "see thr_1" });

    await cli("mv", item.id, "done");
    expect((await cli("ls")).stdout).toBe("(none)");
    expect((await cli("ls", "--all")).stdout).toContain(item.id);
    expect((await cli("ls", "done")).stdout).toContain(item.id);
    expect((await cli("statuses")).stdout).toBe(
      "needs-you  (0)\nbacklog  (0)\nto-do  (0)\ndoing  (0)\ndone  (1)\nblocked  (0)\narchived  (0)",
    );

    expect((await cli("rm", item.id)).stdout).toBe(`removed ${item.id}`);
    expect((await cli("ls", "--all")).stdout).toBe("(none)");
    expect(harness.inspection.realtimeSignals.some((s) => s.channel === "board-changed")).toBe(true);
    await harness.lifecycle.dispose();
  });

  it("fails with exit 1 on bad input", async () => {
    const { harness, cli } = await load();
    const bad = await cli("mv", "zz", "doing");
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr).toContain("no item: zz");
    expect((await cli("add", "x", "-s", "review")).stderr).toContain("unknown status: review");
    expect((await cli("set", "zz")).exitCode).toBe(1);
    await harness.lifecycle.dispose();
  });

  it("serves the board over RPC", async () => {
    const { harness } = await load();
    const item = (await harness.behavior.callRpc("item_add", { title: "Via page", status: "doing" })) as { id: string; lane: string; actions: unknown[] };
    expect(item.lane).toBe("doing");
    expect(item.actions).toHaveLength(1);
    await harness.behavior.callRpc("item_update", { id: item.id, status: "archived" });
    const board = (await harness.behavior.callRpc("board_get", null)) as { file: string; items: { lane: string }[] };
    expect(board.file).toBe(join(dir, "board.json"));
    expect(board.items.map((i) => i.lane)).toEqual(["archived"]);
    await expect(harness.behavior.callRpc("item_update", { id: item.id, status: "review" })).rejects.toThrow();
    await harness.behavior.callRpc("item_remove", { id: item.id });
    await harness.lifecycle.dispose();
  });
});
