# bb-plugin-streamer-mode

Streamer mode for bb. Every email address shown in the app, including the
account rows in the usage menu, is masked to the first two characters of the
name and the domain: `email@example.com` becomes `em•••@ex•••.com`.

Text inputs, textareas, and contenteditable regions are left untouched.
Disable the plugin to show full addresses again:

```
bb plugin disable streamer-mode
bb plugin enable streamer-mode
```
