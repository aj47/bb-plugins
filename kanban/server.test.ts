import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import plugin from "./server.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kanban-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

async function load() {
  const { bb, harness } = createFakePluginHost({
    pluginId: "kanban",
    settings: { boardFile: join(dir, "board.json") },
  });
  await plugin(bb);
  const cli = (...argv: string[]) => harness.behavior.runCli(argv);
  return { harness, cli };
}

describe("bb kanban", () => {
  it("creates, lists, shows, edits, moves and deletes", async () => {
    const { harness, cli } = await load();
    const added = await cli("add", "Write", "the", "docs", "-s", "todo", "-n", "see thr_1", "--json");
    expect(added.exitCode).toBe(0);
    const item = JSON.parse(added.stdout);
    expect(item).toMatchObject({ title: "Write the docs", lane: "to-do", note: "see thr_1" });

    expect((await cli("ls")).stdout).toBe(`${item.id}  to-do  Write the docs (+note)`);
    expect((await cli("mv", item.id, "blocked")).stdout).toContain("blocked");
    expect((await cli("set", item.id, "-t", "Write docs", "-s", "doing")).stdout).toBe(
      `${item.id}  doing  Write docs (+note)`,
    );
    expect(JSON.parse((await cli("show", item.id)).stdout)).toMatchObject({ title: "Write docs", note: "see thr_1" });

    await cli("mv", item.id, "done");
    expect((await cli("ls")).stdout).toBe("(none)");
    expect((await cli("ls", "--all")).stdout).toContain(item.id);
    expect((await cli("ls", "done")).stdout).toContain(item.id);
    expect((await cli("statuses")).stdout).toBe(
      "backlog  (0)\nto-do  (0)\ndoing  (0)\ndone  (1)\nblocked  (0)\narchived  (0)",
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
    const item = (await harness.behavior.callRpc("item_add", { title: "Via page", status: "doing" })) as { id: string };
    await harness.behavior.callRpc("item_update", { id: item.id, status: "archived" });
    const board = (await harness.behavior.callRpc("board_get", null)) as { file: string; items: { lane: string }[] };
    expect(board.file).toBe(join(dir, "board.json"));
    expect(board.items.map((i) => i.lane)).toEqual(["archived"]);
    await expect(harness.behavior.callRpc("item_update", { id: item.id, status: "review" })).rejects.toThrow();
    await harness.behavior.callRpc("item_remove", { id: item.id });
    await harness.lifecycle.dispose();
  });
});
