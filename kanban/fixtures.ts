// A card that passes the rules, for tests.
import type { CardInput } from "./board";

export const PROMPT =
  "Write the setup docs for the kanban plugin in README.md: how to install it, where the board file lives, and how the bb kanban command works. Read server.ts and board.ts first. Done when: README.md has a Setup section and npm test passes.";

export const good = (over: CardInput = {}): CardInput & { title: string } => ({
  title: "Write the docs",
  why: "New users can't find the board file.",
  tags: ["docs"],
  actions: [{ label: "Write them", prompt: PROMPT }],
  status: "to-do",
  ...over,
});
