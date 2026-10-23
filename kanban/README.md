# Kanban

One backlog for all work in progress, with fixed statuses: `backlog`, `to-do`, `doing`, `done`, `blocked`, `archived`.

- `bb kanban` command for agents and terminals: `ls`, `show`, `add`, `mv`, `set`, `rm`, `statuses`, `path`. Run `bb kanban --help`.
- A **Kanban** page in the BB sidebar that lists items by status, adds items, changes status, and deletes.
- A `kanban` skill that tells agents how to use the command.

## Storage

The board is one JSON file, by default `~/Documents/admin/kanban/board.json`. Change it with `bb plugin config kanban set boardFile <path>` and reload the plugin. The file is created on the first write.

The format is the standalone `kb` tool's (`{ lanes, items: [{ id, title, note, lane, created, updated }] }`), and writes use the same `<file>.lock` and atomic rename, so `KB_DATA=<file> kb ...` works on the same board outside BB. kb's starter lanes map to statuses (`To Do` → `to-do`, `Doing Now` → `doing`). The plugin refuses to read or write a file that is not a board, or whose items have another lane, rather than rewrite it. Unknown fields are kept.

## Develop

```sh
npm install --include=dev
npx tsc --noEmit
npm test
bb plugin build
bb plugin install .
```
