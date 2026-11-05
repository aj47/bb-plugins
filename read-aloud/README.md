# Read Aloud

Reads agent replies aloud in bb threads, so you can listen and reply by typing or dictating. Works on desktop and in the [bb voice](https://github.com/aj47/bb-voice) Android app.

## Use it

- **Speaker button beside the composer:** turns read-aloud on or off for that thread. While it's talking, one tap stops the current message. The setting stays on until you turn it off.
- **Read aloud on a message:** the button in each message's action bar reads that one message. Tap it again to stop. If text is selected, it reads the selection.
- **Thread actions menu:** "Read replies aloud" does the same as the speaker button.
- **Composer + menu:** "Read last reply aloud".
- **Agents and scripts:** `bb read-aloud on|off <thread-id>` and `bb read-aloud status`.

Tapping any button, including the mic, stops playback so dictation doesn't record it. Audio only plays on a device that has the thread open with the app in front.

## Settings

`bb plugin config read-aloud` or the plugin's settings page:

- `mode`: `all` reads each message as it arrives; `final` reads only the turn's last message.
- `rate`: speaking speed, where 1 is normal.
- `voice`: part of a system voice name. Leave empty for the device default. The bb voice app always uses the phone's default voice.

## How it works

`server.ts` watches threads with read-aloud on and pushes each finished reply over realtime as speakable text (`speech-text.ts`). `app.tsx` speaks it on the device that has the thread open.

Browsers and the desktop app use the Web Speech API. Android WebViews don't have it, so inside bb voice the plugin speaks through the app's native text-to-speech over the WebView bridge, which needs bb voice 0.4.0 or later. bb hides composer actions in compact layout, so the app gets its speaker button from a content script.

Speech uses the device's own voices, so nothing is sent to an outside service.
