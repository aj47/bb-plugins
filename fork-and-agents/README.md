# fork-and-agents

A bb plugin that adds forking from any message and a view of a thread's background work.

## Fork from here

Every chat message gets a fork button in its action bar. It opens a **Fork thread** panel showing the message, an optional first message for the fork, and a workspace choice: the same workspace, a new worktree, or a new personal workspace.

- Forking from a user message branches just before it, like editing it.
- Forking from an assistant message branches right after its turn.
- **Fork thread** in the side panel's new-tab list forks at the latest turn.

## Background agents

- The thread header gets an **Agents** button showing a live count of running background tasks, workflows and child threads.
- The **Background agents** panel refreshes every two seconds and lists:
  - background tasks and workflows, with status, run time, tool uses and tokens
  - every native subagent call; expand one to read its output
  - bb child threads, which open when clicked
- The quick palette (Mod+Shift+P) has **Fork And Agents: show background agents**.

## Files

- `app.tsx` holds everything; it calls the bb SDK from the frontend.
- `server.ts` is a stub, because bb requires a backend entry.
- `components/ui/` is vendored UI source from the bb component registry.
