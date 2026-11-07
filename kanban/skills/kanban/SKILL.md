---
name: kanban
description: Track work on the shared Kanban board with the `bb kanban` CLI. Use when the user asks to add, list, review, move, update, block, finish, archive, or delete board items, asks what is in progress, or when you need the user to choose something.
---

# Kanban board

One board holds all of the user's work, across projects and harnesses. It is
the single record of work (the old decision queue is retired). Statuses:
`needs-you`, `backlog`, `to-do`, `doing`, `blocked`, `done`, `archived`.

The user reads cards at a glance and acts with one click, so every card is
written for that. **The plugin checks every card on write and refuses a bad
one with the full list of problems.** Fix them all and write again.

## A card

```json
{
  "title": "Ship the 'next serve' default on TennisCamera",
  "why": "Points get cut early whenever the rally audio is misheard.",
  "tags": ["tennis"],
  "status": "to-do",
  "actions": [
    { "label": "Port, test, ask to deploy", "recommended": true,
      "prompt": "<everything a fresh agent needs> ... Done when: <check>" }
  ],
  "note": "optional extra context, shown only when the card is opened"
}
```

- **title**: at most 60 chars. Name the thing or start with a verb. No
  `Decide:`/`Do:` prefixes, no `[tags]`, no ids or thread refs.
- **why**: one line, at most 120 chars: why it matters, or what it is.
- **tags**: 1 to 3, lowercase (`video`, `tennis`, `gmclip`, `skills`, ...).
  Video cards carry their stage as a tag: `picked`, `script`, `film`, `edit`.
- **actions**: the buttons. Each click starts a **new thread** with the
  prompt, and the card moves to `doing`. So the prompt must stand alone: the
  goal, the files, links and `@thread:` refs to read, the constraints from the
  agency policy, and a `Done when:` line. At least 200 chars. Labels at most 28
  chars. Optional `project` (a bb project id) picks where the thread starts.
  `{ "label": "Let it go", "archive": true }` is a button that archives.
- **needs-you**: 2 to 4 actions (the choices), exactly one `recommended`.
  Before you make one, do all the work up to the irreversible step, so each
  choice's prompt carries it out. Keep the column at 5 or fewer.
- **blocked**: needs `waitsOn` (at most 80 chars), e.g. "AJ validating the
  app on his own matches". Actions optional.
- **to-do, doing, backlog**: 1 to 3 actions; mark the main one recommended.

## Commands

| Command | Effect |
| --- | --- |
| `bb kanban ls [status] [--all]` | One line per card: `id  status  title  #tags`. Hides done and archived unless asked. |
| `bb kanban show <id>` | The full card as JSON. |
| `bb kanban add --spec-stdin <<'EOF' ... EOF` | Add a card from JSON. |
| `bb kanban set <id> --spec-stdin` | Change fields from JSON (only the keys you give). Flags `-t`, `-w`, `--tag`, `--waits-on`, `-n`, `-s` work too. |
| `bb kanban run <id> [n] [-p "<instruction>"]` | Run action `n` (default: the recommended one), or `-p` your own instruction with the card's context attached. |
| `bb kanban done <id>... [-r "<result>"]` | Mark done; `-r` adds a one-line result to the note. |
| `bb kanban archive <id>... [--done]` | Archive; `--done` archives everything in done. |
| `bb kanban mv <id> <status>` | Move. The card must pass the rules for its new status. |
| `bb kanban lint` | Open cards that break the rules. |
| `bb kanban rm <id>` | Delete (only duplicates and mistakes). |

Ids accept a unique prefix. Add `--json` when output drives code.

## Rules

- Run `bb kanban ls --all` before changing the board; never guess an id.
- Add only work the user asked for or agreed to.
- When a thread was started from a card, its prompt names the card id: finish
  with `bb kanban done <id> -r "<result>"`, turn the card into a needs-you card
  if the user must choose, or set it to blocked with `--waits-on`.
- When the user rejects something, record why in the note so it isn't raised
  again.
- When you add a card from your own thread, mention it in the note as
  `@thread:<id>` so the card gets an **Open thread** button.
- A card a person added by hand has the `inbox` tag and a "Write the ticket"
  action; running it rewrites the card properly.
- Change the board only through `bb kanban`, never by editing the file.
