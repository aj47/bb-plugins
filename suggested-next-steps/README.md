# bb-plugin-suggested-next-steps

Agents end their replies with a `next-steps` fence, and bb shows each line as a button under the message.

- `server.ts` adds an instruction to every thread with `bb.agents.contributeInstructions`. The `enabled` setting turns it off.
- `app.tsx` registers an `experimental_codeFenceRenderer` for `next-steps`. Click a button to send its line as the next message. Option-click, or click while the composer has text, to insert the line instead.
- `skills/suggested-next-steps/SKILL.md` documents the fence format.

```
bb plugin install .
bb plugin dev
```
