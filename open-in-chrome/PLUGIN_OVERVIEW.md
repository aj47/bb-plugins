Open HTTP(S) links from bb in Google Chrome instead of the in-app browser.

## What you get

- Ordinary clicks on external web links in chat, markdown, terminals, and plugin UI open in Google Chrome, including `_blank` markdown anchors and xterm-detected URLs.
- Internal bb routes, modifier clicks, and non-http schemes keep their existing behavior.
- `bb open-in-chrome open <url>` opens a URL in Chrome from the CLI or an agent. With several machines connected, that defaults to bb's primary host.
