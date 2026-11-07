// Fixed statuses and the item shape, shared by the server and the pages.
// `needs-you` holds only choices waiting on the user; `blocked` is for work
// waiting on something else (another card, a person, hardware).
export const STATUSES = ["needs-you", "backlog", "to-do", "doing", "done", "blocked", "archived"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_NAMES: Record<Status, string> = {
  "needs-you": "Needs you",
  backlog: "Backlog",
  "to-do": "To-do",
  doing: "Doing",
  done: "Done",
  blocked: "Blocked",
  archived: "Archived",
};

/** Statuses `list` hides unless asked. */
export const CLOSED: readonly Status[] = ["done", "archived"];

/**
 * A button on a card. Clicking it starts a new thread with `prompt`, or, when
 * `archive` is set, archives the card (for choices like "let it go").
 */
export interface Action {
  label: string;
  prompt?: string;
  /** bb project id the thread starts in; defaults to the plugin setting. */
  project?: string;
  /** The suggested choice. Exactly one on a needs-you card. */
  recommended?: boolean;
  archive?: boolean;
}

export interface Item {
  id: string;
  title: string;
  /** One sentence shown under the title: why it matters or what it is. */
  why?: string;
  tags?: string[];
  actions?: Action[];
  /** What a blocked card waits on. */
  waitsOn?: string;
  /** Threads started from this card. */
  threads?: string[];
  /** Extra context, shown only when the card is opened. */
  note: string;
  lane: Status;
  created: string;
  updated: string;
}

const THREAD_ID = /\bthr_[a-z0-9]{6,}\b/g;

/**
 * Threads related to a card, most relevant first: the ones started from it
 * (newest first), then the ones its note mentions (notes grow at the end, so
 * newest first), then its why, then its action prompts.
 */
export function cardThreads(item: Pick<Item, "threads" | "note" | "why" | "actions">): string[] {
  const mentions = (text = "") => text.match(THREAD_ID) ?? [];
  return [
    ...new Set([
      ...[...(item.threads ?? [])].reverse(),
      ...[...mentions(item.note)].reverse(),
      ...mentions(item.why),
      ...(item.actions ?? []).flatMap((a) => mentions(a.prompt)),
    ]),
  ];
}
