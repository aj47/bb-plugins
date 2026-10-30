---
name: suggested-next-steps
description: Format of the `next-steps` fence that the Suggested Next Steps plugin renders as follow-up buttons, and how to turn it off. Use when writing suggested follow-ups at the end of a reply or when the user asks about the suggestion buttons.
---

# Suggested next steps

End a reply that has natural follow-ups with a fenced block whose language is `next-steps`:

````
```next-steps
Run the test suite
Commit these changes
```
````

bb renders each line as a button under the message. Clicking a button sends that line as the user's next message. Option-clicking it, or clicking while the composer already holds text, inserts the line into the composer.

- 2 to 4 lines, each under 80 characters, written as the user's next message in the imperative.
- One suggestion per line. Do not add bullets, numbering or other text. bb strips stray markers, keeps the first 4 unique lines, and cuts each to 200 characters.
- Leave the block out when there is no clear follow-up or when the reply ends with a question to the user.

## Setting

`enabled` (default `true`) controls whether agents are told to emit the block. Change it with `bb plugin config suggested-next-steps`, then reload the plugin. The change applies to provider sessions started afterwards. Existing fences keep rendering as buttons while the plugin is installed.
