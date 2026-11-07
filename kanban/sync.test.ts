import { describe, expect, it, vi } from "vitest";
import { createBoardSync } from "./sync";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

describe("board sync", () => {
  it("keeps the newest load when responses arrive out of order", async () => {
    const older = deferred<string>();
    const newer = deferred<string>();
    const load = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const apply = vi.fn();
    const sync = createBoardSync(load, apply, () => {});
    const first = sync.refetch();
    const second = sync.refetch();
    newer.resolve("new");
    await second;
    older.resolve("old");
    await first;
    expect(apply.mock.calls).toEqual([["new"]]);
  });

  it("ignores a failed load that a newer one replaced", async () => {
    const older = deferred<string>();
    const load = vi.fn().mockReturnValueOnce(older.promise).mockResolvedValueOnce("new");
    const fail = vi.fn();
    const sync = createBoardSync(load, () => {}, fail);
    const first = sync.refetch();
    await sync.refetch();
    older.reject(new Error("timed out"));
    await first;
    expect(fail).not.toHaveBeenCalled();
  });

  it("reports a failed load", async () => {
    const fail = vi.fn();
    await createBoardSync(() => Promise.reject(new Error("down")), () => {}, fail).refetch();
    expect(fail).toHaveBeenCalledWith(new Error("down"));
  });

  it("reloads after a write", async () => {
    const apply = vi.fn();
    await createBoardSync(() => Promise.resolve("saved"), apply, () => {}).settle(Promise.resolve());
    expect(apply).toHaveBeenCalledWith("saved");
  });

  it("restores the server's state after a refused write, then shows the error", async () => {
    const order: string[] = [];
    const sync = createBoardSync(
      () => Promise.resolve("from server"),
      (value) => order.push(value),
      (cause) => order.push((cause as Error).message),
    );
    await sync.settle(Promise.reject(new Error("a blocked card needs waitsOn")));
    expect(order).toEqual(["from server", "a blocked card needs waitsOn"]);
  });
});
