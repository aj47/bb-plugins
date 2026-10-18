---
name: media
description: Show a local image, video or audio file inline in the chat. Use when the user asks to see generated or downloaded media, or when the main output of a task is a media file.
---

# Show media in chat

Write a leaf directive on its own line in the reply:

```
::media{file="/absolute/path/to/clip.mp4"}
```

- `file` must be an absolute path. Images (png, jpg, gif, webp, avif, svg), video (mp4, mov, webm, m4v) and audio (mp3, wav, m4a, ogg, flac) are supported.
- Optional `caption="..."` replaces the path under the media; `alt="..."` sets image alt text.
- Only the file's own directory is served, through a preview link that expires after an hour.
- Keep the path as backup text in the reply, since the directive only renders in bb.
