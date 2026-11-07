# Kanban

One board for all work, with fixed statuses: `needs-you` (choices waiting on you), `backlog`, `to-do`, `doing`, `done`, `blocked`, `archived`.

Every card has a short title, a one-line why, 1-3 tags and action buttons. Each button starts a new bb thread with a self-contained prompt (or archives the card), and the card moves to Doing. The rules in `rules.ts` are enforced on every write, from the CLI and the page; `bb kanban lint` lists old cards that break them. A quick add from a page becomes an `inbox` card whose action asks an agent to write the full ticket.

- `bb kanban` command for agents and terminals: `ls`, `show`, `add`, `mv`, `set`, `done`, `archive`, `rm`, `statuses`, `path`. Run `bb kanban --help`.
- A **Kanban** page in the BB sidebar: status columns, drag a card to move it, use the ✓ and archive buttons on each card (or Archive all in Done), click a card to edit its title, note and status, search, and an **Open thread** button on every card with a related thread: one started from the card, or else one its note, why or action prompts mention. Opening a card lists all of them.
- A `kanban` skill that tells agents how to use the command.

## Storage

The board is one JSON file, by default `~/Documents/admin/kanban/board.json`. Change it with `bb plugin config kanban set boardFile <path>` and reload the plugin. The file is created on the first write.

The format is the standalone `kb` tool's (`{ lanes, items: [{ id, title, note, lane, created, updated }] }`), and writes use the same `<file>.lock` and atomic rename, so `KB_DATA=<file> kb ...` works on the same board outside BB. kb's starter lanes map to statuses (`To Do` → `to-do`, `Doing Now` → `doing`). The plugin refuses to read or write a file that is not a board, or whose items have another lane, rather than rewrite it. Unknown fields are kept.

Every write publishes `board-changed`, and a watcher does the same for writes from outside the plugin, so open pages reload. Those signals are ephemeral, so a page also reloads when its realtime connection returns and when it regains focus or becomes visible. A write the server refuses reloads the board too, which puts an optimistically moved card back.

## Develop

```sh
npm install --include=dev
npx tsc --noEmit
npm test
bb plugin build
bb plugin install .
```
