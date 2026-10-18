// bb-plugin-fork-and-agents — frontend entry.
//
// Two features:
// - "Fork from here" on every chat message opens a Fork panel that forks the
//   thread after that message's turn (or before it, for a user message).
// - A header button and a "Background agents" panel that show the thread's
//   native subagents, background tasks, workflows, and bb child threads.
//
// Compiled by `bb plugin build` into dist/app.js + dist/app.css. React and
// @get-bb/plugin-sdk/app are provided by the BB app at load time.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  definePluginApp,
  experimental_useSidebarThreads,
  useBbNavigate,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import type {
  JsonValue,
  PluginThreadHeaderActionProps,
  PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

const FORK_PANEL = "fork";
const AGENTS_PANEL = "agents";
const POLL_MS = 2000;

type Sdk = ReturnType<typeof useSdk>;
type Timeline = Awaited<ReturnType<Sdk["threads"]["timeline"]>>;
type TimelineRow = Timeline["rows"][number];
type BackgroundWork = Timeline["activeBackgroundCommands"][number];

// ---------------------------------------------------------------------------
// Fork

/** Params a message action passes to the Fork panel; untrusted on read. */
interface ForkParams {
  sourceSeqEnd: number | null;
  role: "user" | "assistant" | null;
  preview: string;
}

function readForkParams(params: JsonValue | null): ForkParams {
  const record =
    params !== null && typeof params === "object" && !Array.isArray(params)
      ? params
      : {};
  const seq = record.sourceSeqEnd;
  const role = record.role;
  const preview = record.preview;
  return {
    sourceSeqEnd:
      typeof seq === "number" && Number.isInteger(seq) && seq >= 0 ? seq : null,
    role: role === "user" || role === "assistant" ? role : null,
    preview: typeof preview === "string" ? preview.slice(0, 600) : "",
  };
}

type EnvironmentChoice = "same" | "worktree" | "personal";

const ENVIRONMENT_CHOICES: { value: EnvironmentChoice; label: string }[] = [
  { value: "same", label: "Same workspace" },
  { value: "worktree", label: "New worktree" },
  { value: "personal", label: "New personal workspace" },
];

/** The fork request's `environment` for a fresh workspace on the source host. */
function forkEnvironment(choice: Exclude<EnvironmentChoice, "same">) {
  return {
    type: "host" as const,
    workspace:
      choice === "worktree"
        ? { type: "managed-worktree" as const, baseBranch: { kind: "default" as const } }
        : { type: "personal" as const },
  };
}

function ForkPanel({ threadId, params }: PluginThreadPanelProps) {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const fork = useMemo(() => readForkParams(params), [params]);
  const [prompt, setPrompt] = useState("");
  const [environment, setEnvironment] = useState<EnvironmentChoice>("same");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const text = prompt.trim();
      const created = await sdk.threads.fork({
        sourceThreadId: threadId,
        ...(fork.sourceSeqEnd === null ? {} : { sourceSeqEnd: fork.sourceSeqEnd }),
        ...(environment === "same" ? {} : { environment: forkEnvironment(environment) }),
        ...(text === ""
          ? {}
          : { input: [{ type: "text" as const, text, mentions: [] }] }),
      });
      navigate.toThread(created.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  const anchorLabel =
    fork.sourceSeqEnd === null
      ? "Forks the whole conversation at its latest turn."
      : fork.role === "user"
        ? "Forks just before this message, like editing it."
        : "Forks right after this message's turn.";

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div>
        <p className="text-muted-foreground">{anchorLabel}</p>
        {fork.preview === "" ? null : (
          <blockquote className="mt-2 line-clamp-6 whitespace-pre-wrap rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
            {fork.preview}
          </blockquote>
        )}
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="font-medium">First message (optional)</span>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void submit();
            }
          }}
          rows={4}
          placeholder="Leave empty for an idle fork"
          className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </label>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 font-medium">Workspace</legend>
        {ENVIRONMENT_CHOICES.map((choice) => (
          <label key={choice.value} className="flex items-center gap-2">
            <input
              type="radio"
              name="fork-environment"
              value={choice.value}
              checked={environment === choice.value}
              onChange={() => setEnvironment(choice.value)}
            />
            {choice.label}
          </label>
        ))}
      </fieldset>
      {error === null ? null : (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <div>
        <Button onClick={() => void submit()} disabled={pending}>
          <Icon name="GitFork" className="size-4" />
          {pending ? "Forking…" : "Fork thread"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Background agents

/** Every native subagent call in the timeline, nested ones included. */
function collectDelegations(rows: readonly TimelineRow[]) {
  const found: Extract<TimelineRow, { workKind: "delegation" }>[] = [];
  const visit = (row: TimelineRow) => {
    if (row.kind === "turn") {
      row.children?.forEach(visit);
      return;
    }
    if (row.kind === "work" && row.workKind === "delegation") {
      found.push(row);
      row.childRows?.forEach(visit);
    }
  };
  rows.forEach(visit);
  return found.reverse();
}

function useTimeline(threadId: string) {
  const sdk = useSdk();
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const next = await sdk.threads.timeline({
          threadId,
          includeNestedRows: "true",
          signal,
        });
        setTimeline(next);
        setError(null);
      } catch (cause) {
        if (signal?.aborted) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [sdk, threadId],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = setInterval(() => void load(controller.signal), POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [load]);
  return { timeline, error };
}

function useChildThreads(threadId: string) {
  const { threads } = experimental_useSidebarThreads();
  return useMemo(
    () => threads.filter((thread) => thread.parentThreadId === threadId),
    [threads, threadId],
  );
}

const RUNNING_TASK_STATES = new Set(["pending", "running", "paused"]);

function StatusDot({ tone }: { tone: "running" | "done" | "failed" | "idle" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-1.5 inline-block size-2 shrink-0 rounded-full",
        tone === "running" && "animate-pulse bg-primary",
        tone === "done" && "bg-muted-foreground/50",
        tone === "failed" && "bg-destructive",
        tone === "idle" && "border border-muted-foreground/60",
      )}
    />
  );
}

function rowTone(status: string): "running" | "done" | "failed" | "idle" {
  if (status === "pending" || status === "running" || status === "active" || status === "starting") {
    return "running";
  }
  if (status === "error" || status === "failed" || status === "killed") return "failed";
  if (status === "idle") return "idle";
  return "done";
}

function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title} <span className="tabular-nums">({count})</span>
      </h3>
      {count === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
          None
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
          {children}
        </ul>
      )}
    </section>
  );
}

function BackgroundWorkItem({ work }: { work: BackgroundWork }) {
  const running = RUNNING_TASK_STATES.has(work.taskStatus);
  const end = work.completedAt ?? Date.now();
  return (
    <li className="flex gap-2 px-3 py-2">
      <StatusDot tone={running ? "running" : rowTone(work.taskStatus)} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{work.description || work.taskType}</div>
        <div className="text-xs text-muted-foreground">
          {work.taskType} · {work.taskStatus} · {formatDuration(end - work.startedAt)}
          {work.usage === null
            ? ""
            : ` · ${work.usage.toolUses} tools · ${work.usage.totalTokens.toLocaleString()} tokens`}
        </div>
        {work.summary ? (
          <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
            {work.summary}
          </p>
        ) : null}
        {work.error ? (
          <p className="mt-1 text-xs text-destructive">{work.error}</p>
        ) : null}
      </div>
    </li>
  );
}

function DelegationItem({
  row,
}: {
  row: Extract<TimelineRow, { workKind: "delegation" }>;
}) {
  const [open, setOpen] = useState(false);
  const end = row.completedAt ?? Date.now();
  return (
    <li className="px-3 py-2">
      <button
        type="button"
        className="flex w-full gap-2 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <StatusDot tone={rowTone(row.status)} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">
            {row.description || row.subagentType || row.toolName}
          </div>
          <div className="text-xs text-muted-foreground">
            {[
              row.subagentType,
              row.background ? "background" : "foreground",
              row.status,
              formatDuration(end - row.startedAt),
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <Icon
          name={open ? "ChevronDown" : "ChevronRight"}
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        />
      </button>
      {open ? (
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-xs">
          {row.output.trim() === "" ? "No output yet." : row.output}
        </pre>
      ) : null}
    </li>
  );
}

function AgentsPanel({ threadId }: PluginThreadPanelProps) {
  const navigate = useBbNavigate();
  const { timeline, error } = useTimeline(threadId);
  const children = useChildThreads(threadId);
  const delegations = useMemo(
    () => (timeline === null ? [] : collectDelegations(timeline.rows)),
    [timeline],
  );
  const background = useMemo(() => {
    if (timeline === null) return [];
    const byId = new Map<string, BackgroundWork>();
    for (const work of [
      ...timeline.activeBackgroundCommands,
      ...timeline.activeWorkflows,
    ]) {
      byId.set(work.id, work);
    }
    return [...byId.values()];
  }, [timeline]);

  return (
    <div className="flex flex-col gap-5 text-sm">
      {error === null ? null : (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {timeline === null && error === null ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : null}
      <Section title="Background tasks" count={background.length}>
        {background.map((work) => (
          <BackgroundWorkItem key={work.id} work={work} />
        ))}
      </Section>
      <Section title="Subagents" count={delegations.length}>
        {delegations.map((row) => (
          <DelegationItem key={row.id} row={row} />
        ))}
      </Section>
      <Section title="bb child threads" count={children.length}>
        {children.map((thread) => (
          <li key={thread.id}>
            <button
              type="button"
              className="flex w-full gap-2 px-3 py-2 text-left hover:bg-state-hover"
              onClick={() => navigate.toThread(thread.id)}
            >
              <StatusDot tone={rowTone(thread.runtimeStatus ?? thread.status)} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{thread.displayTitle}</div>
                <div className="text-xs text-muted-foreground">
                  {thread.providerId} · {thread.status}
                </div>
              </div>
            </button>
          </li>
        ))}
      </Section>
    </div>
  );
}

/** Header button: live count of running background work, opens the panel. */
function AgentsHeaderButton({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const navigate = useBbNavigate();
  const { threads } = experimental_useSidebarThreads();
  const count = useMemo(() => {
    let total = 0;
    for (const thread of threads) {
      if (thread.id === threadId) {
        total +=
          thread.activity.backgroundAgents +
          thread.activity.backgroundCommands +
          thread.activity.workflows;
      } else if (
        thread.parentThreadId === threadId &&
        rowTone(thread.runtimeStatus ?? thread.status) === "running"
      ) {
        total += 1;
      }
    }
    return total;
  }, [threads, threadId]);
  const label =
    count === 0 ? "Background agents" : `Background agents (${count} running)`;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 px-2"
      aria-label={label}
      onClick={() => {
        navigate.openThreadPanel({ actionId: AGENTS_PANEL, title: "Background agents" });
      }}
    >
      <Icon name="Bot" className="size-4" />
      {count > 0 ? (
        <span className="tabular-nums text-xs">{count}</span>
      ) : isCompactViewport ? null : (
        <span className="text-xs text-muted-foreground">Agents</span>
      )}
    </Button>
  );
}

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: FORK_PANEL,
    title: "Fork thread",
    icon: "GitFork",
    component: ForkPanel,
  });
  app.slots.threadPanelAction({
    id: AGENTS_PANEL,
    title: "Background agents",
    icon: "Bot",
    component: AgentsPanel,
  });
  app.slots.messageAction({
    id: "fork-from-here",
    title: "Fork from here",
    icon: "GitFork",
    run: ({ message, openPanel }) => {
      openPanel({
        actionId: FORK_PANEL,
        title: "Fork thread",
        params: {
          sourceSeqEnd: message.sourceSeqEnd,
          role: message.role,
          preview: message.text.slice(0, 600),
        },
      });
    },
  });
  app.slots.experimental_threadHeaderAction({
    id: "background-agents",
    title: "Background agents",
    component: AgentsHeaderButton,
  });
  app.commands.register({
    id: "open-background-agents",
    title: "Fork And Agents: show background agents",
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ openPanel }) => {
      openPanel({ actionId: AGENTS_PANEL, title: "Background agents" });
    },
  });
});
