---
name: open-in-chrome
description: Open an HTTP(S) URL in Google Chrome from bb. Use when the user asks to open a web link in Chrome, or when a plugin command should launch Chrome instead of bb's in-app browser.
---

# Open a URL in Chrome

```sh
bb open-in-chrome open <url>
bb open-in-chrome open <url> --host <host-id>
```

- `<url>` must be `http://` or `https://`.
- Omit `--host` when exactly one machine is connected; otherwise pass a host id from `bb machine list`.
- Google Chrome must be installed on that machine (`Google Chrome.app` on macOS).
- This plugin also intercepts ordinary left-clicks on external links in the bb app, including chat markdown `target="_blank"` anchors and URLs in bb terminals, and opens those in Chrome. Modifier clicks and internal bb routes are unchanged.
