// bb-plugin-media — a BB plugin backend entry.
//
// Serves local image, video and audio files to the `::media{file="..."}`
// message directive (app.tsx). `files.createPreview` confines the served root
// to the file's own directory, so only that directory is reachable, and the
// preview URL expires.
import path from "node:path";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const MEDIA_KINDS = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  svg: "image",
  mp4: "video",
  mov: "video",
  webm: "video",
  m4v: "video",
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
  ogg: "audio",
  flac: "audio",
} as const;

const PREVIEW_TTL_MS = 60 * 60 * 1000;

export const rpcContract = defineRpcContract({
  preview: {
    input: z.object({ file: z.string().min(1).max(4096) }).strict(),
    output: z.object({
      url: z.string(),
      kind: z.enum(["image", "video", "audio"]),
      name: z.string(),
    }),
  },
});

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  bb.rpc.register(rpcContract, {
    async preview({ file }) {
      if (!path.isAbsolute(file)) {
        throw new Error("file must be an absolute path");
      }
      const name = path.basename(file);
      const ext = path.extname(name).slice(1).toLowerCase();
      if (!Object.hasOwn(MEDIA_KINDS, ext)) {
        throw new Error(`unsupported media type: .${ext}`);
      }
      const kind = MEDIA_KINDS[ext as keyof typeof MEDIA_KINDS];
      const { baseUrl } = await bb.sdk.files.createPreview({
        rootPath: path.dirname(file),
        ttlMs: PREVIEW_TTL_MS,
      });
      return {
        url: `${baseUrl.replace(/\/$/, "")}/${encodeURIComponent(name)}`,
        kind,
        name,
      };
    },
  });
}
