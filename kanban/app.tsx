// Kanban page. Each card shows its tags, title, one line of why, and buttons
// for the next step: a button starts a new thread with the full task prompt
// (or archives the card). Click a card to read its note or edit it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, FormEvent } from "react";
import { definePluginApp, useBbNavigate, useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { CLOSED, STATUS_NAMES, cardThreads, type Action, type Item, type Status } from "./statuses";
import { createBoardSync } from "./sync";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

const COLUMNS: Status[] = ["needs-you", "to-do", "doing", "blocked", "backlog", "done", "archived"];

function useBoard() {
  const rpc = useRpc<typeof rpcContract>();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const report = useCallback((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)), []);
  const { refetch, settle } = useMemo(
    () =>
      createBoardSync(
        () => rpc.call("board_get"),
        (result) => {
          setItems(result.items as Item[]);
          setError(null);
        },
        report,
      ),
    [rpc, report],
  );
  useEffect(() => void refetch(), [refetch]);
  useRealtime("board-changed", () => void refetch());

  // Signals sent while the connection is down are lost, so catch up on reconnect.
  const connection = useRealtimeConnectionState();
  const lastConnection = useRef(connection);
  useEffect(() => {
    if (connection === "connected" && lastConnection.current !== "connected") void refetch();
    lastConnection.current = connection;
  }, [connection, refetch]);

  // A backgrounded phone can hold a dead socket that still reads as connected.
  useEffect(() => {
    const catchUp = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    window.addEventListener("focus", catchUp);
    document.addEventListener("visibilitychange", catchUp);
    return () => {
      window.removeEventListener("focus", catchUp);
      document.removeEventListener("visibilitychange", catchUp);
    };
  }, [refetch]);

  return { rpc, items, setItems, error, setError, report, refetch, settle };
}

const field =
  "w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function Editor({ item, onSave, onCancel }: { item: Item; onSave: (patch: Record<string, unknown>) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState(item.title);
  const [why, setWhy] = useState(item.why ?? "");
  const [tags, setTags] = useState((item.tags ?? []).join(", "));
  const [waitsOn, setWaitsOn] = useState(item.waitsOn ?? "");
  const [note, setNote] = useState(item.note);
  const [actions, setActions] = useState(JSON.stringify(item.actions ?? [], null, 2));
  const [problem, setProblem] = useState<string | null>(null);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    let parsed: Action[];
    try {
      parsed = JSON.parse(actions);
    } catch {
      return setProblem("Actions must be valid JSON.");
    }
    const patch = { title, why, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), waitsOn, note, actions: parsed };
    await onSave(patch).catch((e) => setProblem(e instanceof Error ? e.message : String(e)));
  };
  return (
    <form onSubmit={save} onKeyDown={(e) => e.key === "Escape" && onCancel()} className="flex flex-col gap-2 rounded-lg border border-ring bg-card p-2.5">
      <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" autoFocus />
      <input className={field} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why, in one line" aria-label="Why" />
      <input className={field} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags, comma separated" aria-label="Tags" />
      {item.lane === "blocked" ? (
        <input className={field} value={waitsOn} onChange={(e) => setWaitsOn(e.target.value)} placeholder="Waits on" aria-label="Waits on" />
      ) : null}
      <textarea className={cn(field, "font-mono text-xs")} rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" aria-label="Note" />
      <textarea className={cn(field, "font-mono text-xs")} rows={6} value={actions} onChange={(e) => setActions(e.target.value)} aria-label="Actions (JSON)" />
      {problem ? <p className="whitespace-pre-wrap text-xs text-destructive">{problem}</p> : null}
      <div className="flex justify-end gap-3 text-sm">
        <button type="button" onClick={onCancel} className="text-muted-foreground hover:text-foreground">
          Cancel
        </button>
        <button type="submit" className="font-medium">
          Save
        </button>
      </div>
    </form>
  );
}

function Card({
  item,
  open,
  onToggle,
  onEdit,
  onMove,
  onRun,
  onCustom,
  onThread,
}: {
  item: Item;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onMove: (lane: Status) => void;
  onRun: (n: number) => void;
  onCustom: (text: string) => void;
  onThread: (id: string) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState("");
  const closed = CLOSED.includes(item.lane);
  const threads = cardThreads(item);
  const thread = threads[0];
  // A card with a running thread has nothing left to start.
  const started = item.lane === "doing" && Boolean(item.threads?.length);
  // On touch screens there is no hover, so the quick actions stay visible at finger size.
  const quiet = "flex items-center justify-center rounded p-1 text-muted-foreground hover:text-foreground pointer-coarse:size-10 pointer-coarse:p-0";
  const quietIcon = "size-3.5 pointer-coarse:size-5";
  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/kanban-id", item.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onClick={onToggle}
      className="group relative cursor-pointer rounded-lg bg-card px-3 py-2.5 text-sm"
    >
      <div className="absolute right-1.5 top-1.5 hidden group-hover:flex pointer-coarse:right-0.5 pointer-coarse:top-0.5 pointer-coarse:flex">
        {closed ? (
          <button type="button" title="Reopen" className={quiet} onClick={(e) => (e.stopPropagation(), onMove("to-do"))}>
            <Icon name="Undo2" className={quietIcon} />
          </button>
        ) : (
          <button type="button" title="Done" className={quiet} onClick={(e) => (e.stopPropagation(), onMove("done"))}>
            <Icon name="Check" className={quietIcon} />
          </button>
        )}
        {item.lane === "archived" ? null : (
          <button type="button" title="Archive" className={quiet} onClick={(e) => (e.stopPropagation(), onMove("archived"))}>
            <Icon name="Archive" className={quietIcon} />
          </button>
        )}
      </div>
      {item.tags?.length ? <div className="text-[11px] text-muted-foreground">{item.tags.join(" · ")}</div> : null}
      <div className="pr-10 font-medium leading-snug pointer-coarse:pr-20">{item.title}</div>
      {item.lane === "blocked" && item.waitsOn ? (
        <div className="mt-0.5 text-xs text-muted-foreground">Waits on {item.waitsOn}</div>
      ) : item.why ? (
        <div className="mt-0.5 text-xs text-muted-foreground">{item.why}</div>
      ) : null}
      {thread || !closed ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {thread ? (
            <button
              type="button"
              title="Opens the card's thread beside the board"
              onClick={(e) => (e.stopPropagation(), onThread(thread))}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground"
            >
              <Icon name="MessageSquare" className="size-3" />
              Open thread
            </button>
          ) : null}
          {closed || started
            ? null
            : item.actions?.map((a, n) => (
                <button
                  key={n}
                  type="button"
                  title={a.archive ? "Archives the card" : "Starts a new thread with the full task"}
                  onClick={(e) => (e.stopPropagation(), onRun(n))}
                  className={cn(
                    "rounded-md px-2 py-1 text-xs",
                    a.recommended || (item.actions!.length === 1 && !a.archive) ? "bg-foreground text-background" : "border border-border text-foreground",
                  )}
                >
                  {a.label}
                </button>
              ))}
          {closed || started ? null : (
            <button type="button" onClick={(e) => (e.stopPropagation(), setAsking((v) => !v))} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
              Something else…
            </button>
          )}
        </div>
      ) : null}
      {asking ? (
        <form
          className="mt-2"
          onClick={(e) => e.stopPropagation()}
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            onCustom(text.trim());
            setText("");
            setAsking(false);
          }}
        >
          <textarea
            autoFocus
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setAsking(false);
              if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), e.currentTarget.form?.requestSubmit());
            }}
            placeholder="What should the agent do? Enter starts a thread with this card's context."
            className={cn(field, "text-xs")}
          />
        </form>
      ) : null}
      {open ? (
        <div className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground" onClick={(e) => e.stopPropagation()}>
          {item.note ? <p className="whitespace-pre-wrap">{item.note}</p> : null}
          <div className="mt-1.5 flex flex-wrap gap-x-3">
            <button type="button" onClick={onEdit} className="hover:text-foreground">
              Edit
            </button>
            {threads.map((t, n) => (
              <button key={t} type="button" title={t} onClick={() => onThread(t)} className="hover:text-foreground">
                Thread {n + 1}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BoardPage() {
  const { rpc, items, setItems, error, setError, report, refetch, settle } = useBoard();
  const navigate = useBbNavigate();
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [over, setOver] = useState<Status | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.undo ? 5000 : 2000);
    return () => clearTimeout(timer);
  }, [toast]);
  const call = settle;
  const toThread = (id: string) => navigate.toThread(id, { split: true });

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (title.trim()) call(rpc.call("item_add", { title: title.trim() }).then(() => setTitle("")));
  };
  const setLane = (id: string, lane: Status) => {
    setItems((prev) => prev?.map((i) => (i.id === id ? { ...i, lane } : i)) ?? prev);
    call(rpc.call("item_update", { id, status: lane }));
  };
  const move = (id: string, lane: Status) => {
    const from = items?.find((i) => i.id === id)?.lane;
    if (!from || from === lane) return;
    setLane(id, lane);
    setToast({ text: `Moved to ${STATUS_NAMES[lane]}`, undo: () => (setLane(id, from), setToast(null)) });
  };
  const archiveAll = (ids: string[]) => {
    const setAll = (status: Status) => call(Promise.all(ids.map((id) => rpc.call("item_update", { id, status }))));
    setAll("archived");
    setToast({ text: `Archived ${ids.length}`, undo: () => (setAll("done"), setToast(null)) });
  };
  const runAction = (id: string, n: number) =>
    rpc.call("item_run", { id, action: n }).then((r) => {
      refetch();
      if (r.threadId) toThread(r.threadId);
    }, report);
  const drop = (lane: Status) => (event: DragEvent) => {
    event.preventDefault();
    setOver(null);
    const id = event.dataTransfer.getData("text/kanban-id");
    if (id) move(id, lane);
  };

  const q = query.trim().toLowerCase();
  const columns = COLUMNS.filter((s) => showClosed || !CLOSED.includes(s));

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 px-4 py-3 md:px-5">
        <form onSubmit={add} className="flex-1">
          <input className={cn(field, "border-transparent bg-muted/40")} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add something… an agent turns it into a ticket" aria-label="Add" />
        </form>
        <input className={cn(field, "w-40 border-transparent bg-muted/40")} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search" />
        <button type="button" onClick={() => setShowClosed((v) => !v)} className="whitespace-nowrap text-xs text-muted-foreground hover:text-foreground">
          {showClosed ? "Hide finished" : "Show finished"}
        </button>
      </div>
      {error ? (
        <p role="alert" onClick={() => setError(null)} className="whitespace-pre-wrap px-4 pb-2 text-xs text-destructive md:px-5">
          {error}
        </p>
      ) : null}
      {items === null ? (
        <p className="px-4 text-sm text-muted-foreground md:px-5">Loading…</p>
      ) : (
        <div className="flex min-h-0 flex-1 snap-x gap-4 overflow-x-auto px-4 pb-4 md:px-5">
          {columns.map((s) => {
            const group = items
              .filter((i) => i.lane === s && (!q || `${i.title} ${i.why ?? ""} ${(i.tags ?? []).join(" ")} ${i.note}`.toLowerCase().includes(q)))
              .sort((a, b) => b.updated.localeCompare(a.updated));
            return (
              <section
                key={s}
                onDragOver={(e) => (e.preventDefault(), setOver(s))}
                onDragLeave={() => setOver((cur) => (cur === s ? null : cur))}
                onDrop={drop(s)}
                className={cn("flex w-72 shrink-0 snap-start flex-col rounded-xl", over === s && "bg-muted/40")}
              >
                <h2 className="flex items-baseline gap-2 px-1 pb-2 text-sm font-medium">
                  {STATUS_NAMES[s]}
                  <span className="text-xs font-normal text-muted-foreground">{group.length}</span>
                  {s === "done" && group.length ? (
                    <button type="button" onClick={() => archiveAll(group.map((i) => i.id))} className="ml-auto text-xs font-normal text-muted-foreground hover:text-foreground">
                      Archive all
                    </button>
                  ) : null}
                </h2>
                <div className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto pb-2">
                  {group.map((item) =>
                    editing === item.id ? (
                      <Editor
                        key={item.id}
                        item={item}
                        onCancel={() => setEditing(null)}
                        onSave={(patch) =>
                          rpc.call("item_update", { id: item.id, ...patch }).then(() => {
                            setEditing(null);
                            refetch();
                          })
                        }
                      />
                    ) : (
                      <Card
                        key={item.id}
                        item={item}
                        open={openId === item.id}
                        onToggle={() => setOpenId((cur) => (cur === item.id ? null : item.id))}
                        onEdit={() => setEditing(item.id)}
                        onMove={(lane) => move(item.id, lane)}
                        onRun={(n) => runAction(item.id, n)}
                        onCustom={(text) =>
                          rpc.call("item_run_custom", { id: item.id, text }).then((r) => {
                            refetch();
                            toThread(r.threadId);
                          }, report)
                        }
                        onThread={toThread}
                      />
                    ),
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {toast ? (
        <div
          role="status"
          className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-lg border border-border bg-card px-3.5 py-2 text-sm shadow-lg"
        >
          {toast.text}
          {toast.undo ? (
            <button type="button" onClick={toast.undo} className="font-medium pointer-coarse:py-1">
              Undo
            </button>
          ) : null}
        </div>
      ) : null}
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
