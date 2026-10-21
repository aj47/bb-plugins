# Hands-free voice

Adds a realtime voice button next to the composer mic in every thread. Tap it to talk to the thread's agent hands-free: speak, pause, and your words are sent; the reply is read back; then it listens again.

- **Desktop (or any browser):** the voice session runs in the page. A voice bar above the composer shows the state and has ✕ to stop. Right-click or long-press the button for settings.
- **[bb voice](https://github.com/aj47/bb-voice) Android app:** the button hands the thread to the app's native voice loop, which keeps working with the screen off or locked.

Both run the same engines from [`@aj47/bb-voice-core`](https://github.com/aj47/bb-voice/tree/main/packages/core).

## Modes

- **GPT-Live:** OpenAI's `gpt-live-1` holds the conversation and a tool model writes the agent's messages and can find, switch, start, read, check and stop threads. Needs an OpenAI API key, billed per minute. On desktop the key is a secret plugin setting; the plugin server relays the WebRTC offer to OpenAI so the key never reaches the page.
- **Free:** on desktop, the mic is cut at each pause and transcribed by bb's own voice service (the one the composer mic uses), and replies are read with the system voice. On the phone, Android's on-device recognizer and text-to-speech.

Settings (mode, key, voice, models) live in Tools → Hands-free voice; the quick-settings popup covers mode, key and voice. The phone keeps its own settings in the app.

## Bridge to the mobile app

- Page → app: `window.ReactNativeWebView.postMessage(JSON.stringify({ type: "bbvoice.toggle", threadId }))`, or `{ type: "bbvoice.settings" }`
- App → page: sets `window.__BB_VOICE__.state = { threadId, phase, mode }` and dispatches a `bbvoice:state` event.

The types are in `@aj47/bb-voice-core` (`bridge.ts`), shared with the app.

## Files

- `app.tsx`: the composer action, voice bar and settings popup (desktop), and the content-script button (mobile shell).
- `voice.ts`: the desktop session store.
- `desktop.ts`: browser adapters for the shared engines (recognizer, speech, WebRTC).
- `bridge.ts`: the mobile shell bridge.
- `server.ts`: settings, the OpenAI key, and the GPT-Live SDP relay.

## Install

```sh
bb plugin install git:https://github.com/aj47/bb-plugins.git@main --plugin handsfree
```
