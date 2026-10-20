# Hands-free voice

Adds a mic button to bb thread headers that starts a hands-free voice session in the [bb voice](https://github.com/aj47/bb-voice) Android app, which loads bb's web UI and runs the voice loop natively, so it works with the screen off or locked.

The button only renders inside bb voice (it checks for `window.__BB_VOICE__` and the React Native WebView bridge). Elsewhere the plugin does nothing.

## Bridge

- Page → app: `window.ReactNativeWebView.postMessage(JSON.stringify({ type: "bbvoice.toggle", threadId }))`
- App → page: sets `window.__BB_VOICE__.state = { threadId, phase, mode }` and dispatches a `bbvoice:state` event.

## Install

```sh
bb plugin install git:https://github.com/aj47/bb-plugins.git@main --plugin handsfree
```
