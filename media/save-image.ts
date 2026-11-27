// Long-press an image in chat on a phone to save it.
//
// A trusted content script: it watches touch presses on images inside
// timeline rows (markdown images, attachments, ::media previews) and the image
// lightbox. Holding one for HOLD_MS opens a small sheet with "Save image".
// The save runs from that tap rather than from the hold timer, because iOS
// only treats a tap (touchend) as a user gesture and the share sheet needs one.
// `experimental_saveFile` downloads in browsers and opens the share sheet
// (with "Save Image") in the bb iOS app.
import { experimental_saveFile, type PluginContentScriptContext } from "@get-bb/plugin-sdk/app";

const HOLD_MS = 450;
const MOVE_TOLERANCE_PX = 10;
const MIN_IMAGE_PX = 48;
const IMAGE_SELECTOR = '[data-timeline-row-id] img, [role="dialog"] img';
const ROOT_ATTR = "data-bb-media-save-sheet";

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/heic": "heic",
};

function saveableImage(target: EventTarget | null): HTMLImageElement | null {
  if (!(target instanceof Element)) return null;
  const image = target.closest("img");
  if (!image || !image.matches(IMAGE_SELECTOR)) return null;
  if (image.closest(`[${ROOT_ATTR}]`)) return null;
  const rect = image.getBoundingClientRect();
  if (rect.width < MIN_IMAGE_PX || rect.height < MIN_IMAGE_PX) return null;
  return image.currentSrc || image.src ? image : null;
}

function fileNameFor(src: string, alt: string, mimeType: string | null): string {
  let base = "";
  try {
    const url = new URL(src, location.href);
    if (url.protocol === "http:" || url.protocol === "https:") {
      base = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    }
  } catch {
    // Keep the fallback below.
  }
  if (!base) base = alt.trim();
  base = base.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").slice(0, 120) || "image";
  const hasExtension = /\.[a-z0-9]{2,5}$/i.test(base);
  const extension = mimeType ? MIME_EXTENSIONS[mimeType.split(";")[0].trim()] : undefined;
  if (hasExtension) return base;
  return `${base}.${extension ?? "png"}`;
}

type SheetHandle = { close: () => void };

function openSheet(image: HTMLImageElement, signal: AbortSignal): SheetHandle {
  const src = image.currentSrc || image.src;
  const alt = image.alt;

  // Fetch the bytes while the sheet is open so the tap can hand over a blob
  // without awaiting. Falls back to the URL when the fetch fails.
  let blob: Blob | null = null;
  const fetchAbort = new AbortController();
  fetch(src, { credentials: "include", signal: fetchAbort.signal })
    .then((response) => (response.ok ? response.blob() : null))
    .then((result) => {
      blob = result;
    })
    .catch(() => {
      blob = null;
    });

  const root = document.createElement("div");
  root.setAttribute(ROOT_ATTR, "");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Image actions");
  root.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483000",
    "display:flex",
    "flex-direction:column",
    "justify-content:flex-end",
    "background:rgba(0,0,0,0.35)",
    "-webkit-tap-highlight-color:transparent",
  ].join(";");

  const panel = document.createElement("div");
  panel.style.cssText = [
    "margin:0 8px calc(8px + env(safe-area-inset-bottom))",
    "display:flex",
    "flex-direction:column",
    "gap:8px",
    "font:inherit",
  ].join(";");

  const group = document.createElement("div");
  group.style.cssText = [
    "display:flex",
    "flex-direction:column",
    "overflow:hidden",
    "border-radius:14px",
    "border:1px solid var(--border, rgba(127,127,127,0.3))",
    "background:var(--popover, #1c1c1e)",
    "color:var(--popover-foreground, #fff)",
  ].join(";");

  const preview = document.createElement("img");
  preview.src = src;
  preview.alt = "";
  preview.draggable = false;
  preview.style.cssText =
    "display:block;max-height:30vh;max-width:100%;margin:12px auto;object-fit:contain;border-radius:8px;pointer-events:none";

  const button = (label: string, strong: boolean) => {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.style.cssText = [
      "appearance:none",
      "border:0",
      "width:100%",
      "min-height:52px",
      "padding:0 16px",
      "font:inherit",
      "font-size:17px",
      `font-weight:${strong ? 600 : 400}`,
      "background:transparent",
      "color:inherit",
      "cursor:pointer",
    ].join(";");
    return element;
  };

  const save = button("Save image", true);
  save.style.borderTop = "1px solid var(--border, rgba(127,127,127,0.3))";
  const cancel = button("Cancel", true);
  cancel.style.borderRadius = "14px";
  cancel.style.border = "1px solid var(--border, rgba(127,127,127,0.3))";
  cancel.style.background = "var(--popover, #1c1c1e)";
  cancel.style.color = "var(--popover-foreground, #fff)";

  group.append(preview, save);
  panel.append(group, cancel);
  root.append(panel);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    fetchAbort.abort();
    document.removeEventListener("keydown", onKeyDown, true);
    signal.removeEventListener("abort", close);
    root.remove();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  save.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const fileName = fileNameFor(src, alt, blob?.type ?? null);
    // saveFile clicks its link synchronously, inside this tap's gesture.
    void experimental_saveFile(blob ? { fileName, blob } : { fileName, url: src });
    close();
  });
  cancel.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    close();
  });
  root.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.target === root) close();
  });
  root.addEventListener("contextmenu", (event) => event.preventDefault());
  document.addEventListener("keydown", onKeyDown, true);
  signal.addEventListener("abort", close);

  document.body.append(root);
  save.focus({ preventScroll: true });
  return { close };
}

export function mountSaveImage({ signal }: PluginContentScriptContext): () => void {
  // Stop iOS's own callout and text selection on chat images so the hold
  // reaches this handler. Touch screens only; desktop right-click is untouched.
  const style = document.createElement("style");
  style.setAttribute(ROOT_ATTR, "style");
  style.textContent = `@media (pointer: coarse) { ${IMAGE_SELECTOR
    .split(",")
    .map((selector) => selector.trim())
    .join(", ")} { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; } }`;
  document.head.append(style);

  let press: { pointerId: number; x: number; y: number; timer: number; image: HTMLImageElement } | null =
    null;
  // After a hold opens the sheet, clicks are swallowed until shortly after
  // that finger lifts, so the lift cannot tap the lightbox or the backdrop.
  let heldPointerId: number | null = null;
  let suppressClickUntil = 0;
  let sheet: SheetHandle | null = null;

  const cancelPress = () => {
    if (!press) return;
    window.clearTimeout(press.timer);
    press = null;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse" || !event.isPrimary) return;
    // A new touch means the held one ended, even if its pointerup was lost.
    heldPointerId = null;
    suppressClickUntil = 0;
    cancelPress();
    const image = saveableImage(event.target);
    if (!image) return;
    const timer = window.setTimeout(() => {
      if (!press) return;
      const target = press.image;
      heldPointerId = press.pointerId;
      press = null;
      suppressClickUntil = Number.POSITIVE_INFINITY;
      window.getSelection()?.removeAllRanges();
      sheet?.close();
      sheet = openSheet(target, signal);
    }, HOLD_MS);
    press = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, timer, image };
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!press || event.pointerId !== press.pointerId) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > MOVE_TOLERANCE_PX) cancelPress();
  };

  const onPointerEnd = (event: PointerEvent) => {
    if (press && event.pointerId === press.pointerId) cancelPress();
    if (heldPointerId === event.pointerId) {
      heldPointerId = null;
      suppressClickUntil = Date.now() + 400;
    }
  };

  // The lift after a hold would otherwise open the lightbox.
  const onClick = (event: MouseEvent) => {
    if (Date.now() >= suppressClickUntil) return;
    event.preventDefault();
    event.stopPropagation();
  };

  // Android Chrome fires contextmenu on a long press; keep its menu away.
  const onContextMenu = (event: MouseEvent) => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    if (saveableImage(event.target)) event.preventDefault();
  };

  const options = { capture: true, signal } as const;
  document.addEventListener("pointerdown", onPointerDown, options);
  document.addEventListener("pointermove", onPointerMove, { ...options, passive: true });
  document.addEventListener("pointerup", onPointerEnd, options);
  document.addEventListener("pointercancel", onPointerEnd, options);
  document.addEventListener("click", onClick, options);
  document.addEventListener("contextmenu", onContextMenu, options);
  window.addEventListener("scroll", cancelPress, { capture: true, passive: true, signal });

  return () => {
    cancelPress();
    sheet?.close();
    sheet = null;
    style.remove();
  };
}
