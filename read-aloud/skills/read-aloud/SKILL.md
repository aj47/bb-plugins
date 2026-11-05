---
name: read-aloud
description: Turn the Read Aloud plugin on or off for a bb thread, or check which threads have it on. Use when the user asks to have replies read out, spoken, or played back as audio in a thread.
---

# Read Aloud

When read-aloud is on for a thread, every assistant reply in it is spoken on
whichever device has the thread open (phone or desktop), as long as the app is
in the foreground. The user toggles it with the speaker button beside the
composer or from the thread's actions menu. It stays on after the thread is
closed until turned off. Each message's action bar also has a Read aloud button
that reads just that message, whether or not the thread has read-aloud on.

On Android, bb runs in the BB Voice app, whose WebView has no speech engine, so
the app speaks natively. That needs a BB Voice build with bridge version 2 or later.

Commands:

- `bb read-aloud status` lists thread ids with read-aloud on.
- `bb read-aloud on <thread-id>` turns it on (`$BB_THREAD_ID` for this thread).
- `bb read-aloud off <thread-id>` turns it off.

Turning it on from the CLI cannot unlock audio on iOS; the user must tap
anything in the app once before speech can play there.

Settings (`bb plugin config read-aloud`): `mode` (`all` reads every message,
`final` only the turn's last one), `rate` (speaking speed, 1 = normal) and
`voice` (part of a system voice name).

Replies are written for reading; when a thread has read-aloud on, prefer short
prose over tables and long code blocks, which are summarized as "code block"
when spoken.
