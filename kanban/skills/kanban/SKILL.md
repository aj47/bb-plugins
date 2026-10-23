---
name: kanban
description: Track work in progress on the shared Kanban backlog with the `bb kanban` CLI. Use when the user asks to add, list, review, move, update, block, finish, archive, or delete backlog items, or asks what is in progress.
---

# Kanban backlog

One board holds all of the user's work in progress, across projects and
harnesses. Statuses are fixed: `backlog`, `to-do`, `doing`, `done`,
`blocked`, `archived`. The Kanban page in the BB sidebar and the `bb kanban`
command read and write the same file.

## Commands

| Command | Effect |
| --- | --- |
| `bb kanban ls [status] [--all]` | One line per item: `id  status  title`. Hides done and archived unless you name a status or pass `--all`. `(+note)` marks an item with a note. |
| `bb kanban show <id>` | The full item as JSON, note included. |
| `bb kanban add <title> [-s status] [-n note]` | Add an item. Default status: `backlog`. |
| `bb kanban mv <id> <status>` | Change the status. |
| `bb kanban set <id> [-t title] [-n note] [-s status]` | Edit fields. `-n` replaces the whole note. |
| `bb kanban rm <id>` | Delete an item. |
| `bb kanban statuses` | Statuses with item counts. |
| `bb kanban path` | The board file. |

Ids accept a unique prefix of two or more characters. Statuses accept their
name, a unique prefix, or `todo`, `wip`, `in-progress`. Add `--json` to
`ls`, `add`, `mv`, `set`, `rm` or `statuses` when output drives code.

## Rules

- Run `bb kanban ls --all` before you change the board, and use the ids it
  prints. Never guess an id.
- Add only work the user asked for or agreed to. Do not invent backlog items.
- Keep titles short and start them with a verb. Put links, thread refs
  (`@thread:thr_…`), and context in the note.
- When an item is blocked, move it to `blocked` and say why in the note.
- Finished work goes to `done`; obsolete work goes to `archived`. Delete only
  duplicates, mistakes, or when the user asks.
- Change the board only through `bb kanban`. Do not edit the board file by
  hand while BB is running.
- A non-zero exit with `no item` or `ambiguous id` means the id is stale:
  list again.
