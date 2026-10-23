// Fixed statuses and the item shape, shared by the server and the page.
export const STATUSES = ["backlog", "to-do", "doing", "done", "blocked", "archived"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_NAMES: Record<Status, string> = {
  backlog: "Backlog",
  "to-do": "To-do",
  doing: "Doing",
  done: "Done",
  blocked: "Blocked",
  archived: "Archived",
};

/** Statuses `list` hides unless asked. */
export const CLOSED: readonly Status[] = ["done", "archived"];

export interface Item {
  id: string;
  title: string;
  note: string;
  lane: Status;
  created: string;
  updated: string;
}
