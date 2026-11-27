# media

A bb plugin that shows local images, videos and audio inline in chat.

An assistant writes a leaf directive on its own line:

```
::media{file="/absolute/path/to/clip.mp4"}
```

- Images: png, jpg, gif, webp, avif, svg. Video: mp4, mov, webm, m4v. Audio: mp3, wav, m4a, ogg, flac.
- `caption="..."` replaces the path shown under the media; `alt="..."` sets image alt text.
- The server serves only the file's own directory, through a preview link that expires after an hour.

## Save images on a phone

Press and hold any image in chat (markdown images, attachments, `::media` previews, or the open lightbox) on a touch screen. A sheet opens with **Save image**; tapping it saves through bb's download path, which opens the share sheet (with "Save Image") in the bb iOS app and downloads the file in a mobile browser. Desktop right-click is unchanged.

The bundled skill in `skills/media` tells agents when and how to use the directive.

## Files

- `server.ts` validates the path and creates the confined preview link.
- `app.tsx` registers the `media` message directive and renders the preview.
- `save-image.ts` is the content script behind the long-press save sheet.
- `components/ui/` is vendored UI source from the bb component registry.
