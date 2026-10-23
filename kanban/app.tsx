// Kanban page: the backlog as a list grouped by status. Add an item, change
// its status, or delete it; edit titles and notes with `bb kanban set`.
// Kept current by the server's "board-changed" signal.
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { definePluginApp, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { CLOSED, STATUSES, STATUS_NAMES, type Item, type Status } from "./statuses";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { formatHomePathForDisplay } from "@/lib/utils";

function useBoard() {
  const rpc = useRpc<typeof rpcContract>();
  const [items, setItems] = useState<Item[] | null>(null);
  const [file, setFile] = useState("");
  const [error, setError] = useState<string | null>(null);
  const report = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause));
  }, []);
  const refetch = useCallback(() => {
    rpc.call("board_get").then((result) => {
      setItems(result.items);
      setFile(result.file);
      setError(null);
    }, report);
  }, [rpc, report]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime("board-changed", refetch);
  return { rpc, items, file, error, report, refetch };
}

function StatusSelect({ value, onChange }: { value: Status; onChange: (status: Status) => void }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as Status)}
      aria-label="Status"
      className="h-9 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {STATUS_NAMES[s]}
        </option>
      ))}
    </select>
  );
}

function BoardPage() {
  const { rpc, items, file, error, report, refetch } = useBoard();
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<Status>("backlog");
  const [showClosed, setShowClosed] = useState(false);
  const run = (promise: Promise<unknown>) => promise.then(refetch, report);
  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = title.trim();
    if (next === "") return;
    run(rpc.call("item_add", { title: next, status }).then(() => setTitle("")));
  };
  const shown = STATUSES.filter((s) => showClosed || !CLOSED.includes(s));
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-3xl px-4 pb-4 pt-3 md:px-5 md:pt-4">
        <form onSubmit={add} className="flex flex-wrap items-center gap-2">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="New item"
            aria-label="New item"
            className="min-w-48 flex-1"
          />
          <StatusSelect value={status} onChange={setStatus} />
          <Button type="submit" disabled={title.trim() === ""}>
            <Icon name="Plus" className="size-4" />
            Add
          </Button>
        </form>
        {error === null ? null : (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>{file ? <code>{formatHomePathForDisplay(file)}</code> : null}</span>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
            Show done and archived
          </label>
        </div>
        {items === null ? (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            Loading…
          </p>
        ) : (
          shown.map((s) => {
            const group = items.filter((i) => i.lane === s);
            return (
              <section key={s} className="mt-4">
                <h2 className="text-sm font-medium">
                  {STATUS_NAMES[s]} <span className="text-muted-foreground">{group.length}</span>
                </h2>
                {group.length === 0 ? null : (
                  <ul className="mt-1 divide-y divide-border rounded-lg border border-border bg-card px-3">
                    {group.map((item) => (
                      <li key={item.id} className="flex items-center gap-2 py-2 text-sm">
                        <span className="min-w-0 flex-1">
                          <span className="block break-words">{item.title}</span>
                          {item.note ? (
                            <span className="line-clamp-2 block text-xs text-muted-foreground">{item.note}</span>
                          ) : null}
                        </span>
                        <span className="hidden font-mono text-xs text-muted-foreground sm:inline">{item.id}</span>
                        <StatusSelect
                          value={item.lane}
                          onChange={(next) => run(rpc.call("item_update", { id: item.id, status: next }))}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-foreground"
                          aria-label={`Delete "${item.title}"`}
                          onClick={() => run(rpc.call("item_remove", { id: item.id }))}
                        >
                          <Icon name="Trash2" className="size-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "board",
    title: "Kanban",
    icon: "ListTodo",
    // Routed at /plugins/kanban/board.
    path: "board",
    component: BoardPage,
  });
});
