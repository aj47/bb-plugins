// bb-plugin-media — a BB plugin frontend entry.
//
// Compiled by `bb plugin build` into dist/app.js. React and
// @get-bb/plugin-sdk/app are provided by the BB app at load time.
//
// Registers the `::media{file="/abs/path.png"}` assistant-message directive,
// which shows a local image, video or audio file inline in chat.
import { useEffect, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";

type Preview = { url: string; kind: "image" | "video" | "audio"; name: string };

function MediaDirective({
  attributes,
  source,
}: {
  attributes: Readonly<Record<string, string>>;
  source: string;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const file = attributes.file;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    rpc.call("preview", { file }).then(
      (result) => {
        if (!cancelled) {
          setPreview(result);
          setError(null);
        }
      },
      (cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, file]);

  if (!file) return <code>{source}</code>;
  if (error) {
    return (
      <div className="text-xs text-muted-foreground">
        Can't show {file}: {error}
      </div>
    );
  }
  if (!preview) return <div className="text-xs text-muted-foreground">Loading {file}…</div>;

  return (
    <figure className="my-2 flex max-w-full flex-col gap-1">
      {preview.kind === "image" && (
        <img
          src={preview.url}
          alt={attributes.alt ?? preview.name}
          className="max-h-[32rem] max-w-full rounded-md border object-contain"
        />
      )}
      {preview.kind === "video" && (
        <video
          src={preview.url}
          controls
          preload="metadata"
          className="max-h-[32rem] max-w-full rounded-md border"
        />
      )}
      {preview.kind === "audio" && <audio src={preview.url} controls className="w-full" />}
      <figcaption className="text-xs text-muted-foreground">{attributes.caption ?? file}</figcaption>
    </figure>
  );
}

export default definePluginApp((app) => {
  app.slots.messageDirective({ id: "media", component: MediaDirective });
});
