# Open in Chrome

A bb plugin that opens HTTP(S) links you click in bb in Google Chrome, instead of bb's in-app browser.

Ordinary left-clicks on external `http`/`https` links are intercepted in the app, including chat markdown links that bb renders with `target="_blank"` and URLs clicked in bb terminals (xterm web-links / OSC-8). Internal bb routes, modifier clicks (⌘-click, middle-click), `mailto:` links, and download links stay on their existing path. The plugin also turns off bb's "open links in the in-app browser" client preference so leftover host routing does not steal the click.

Chrome is launched on a connected machine through the plugin host entry (`open -a "Google Chrome"` on macOS). App clicks and `bb open-in-chrome open` without `--host` use the only connected machine, otherwise bb's primary host, otherwise the unmanaged persistent desktop.

## Files

- `app.ts` registers a content script that intercepts link clicks.
- `server.ts` exposes RPC and `bb open-in-chrome open <url>`.
- `host.ts` launches Chrome on the enrolled machine.

## Commands

```sh
bb open-in-chrome open https://example.com
bb open-in-chrome open https://example.com --host host_abc123
```
