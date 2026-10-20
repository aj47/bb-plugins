// Bridge to the bb voice Android shell, which loads bb's web UI in a WebView
// and owns the native hands-free loop (foreground service, works locked).
//
// Shell → page: injects `window.__BB_VOICE__` before load and dispatches
// `bbvoice:state` whenever the voice session changes.
// Page → shell: `window.ReactNativeWebView.postMessage(JSON)`.

export type VoicePhase = "off" | "listening" | "hearing" | "thinking" | "speaking" | "error";

export type VoiceState = {
  threadId: string | null;
  phase: VoicePhase;
  mode: "classic" | "live";
};

type ShellWindow = Window & {
  __BB_VOICE__?: { version: number; state: VoiceState | null };
  ReactNativeWebView?: { postMessage(message: string): void };
};

const shell = () => window as ShellWindow;

export function inVoiceShell(): boolean {
  const w = shell();
  return Boolean(w.__BB_VOICE__ && w.ReactNativeWebView);
}

export function getVoiceState(): VoiceState | null {
  return shell().__BB_VOICE__?.state ?? null;
}

export function subscribeVoiceState(onChange: () => void): () => void {
  window.addEventListener("bbvoice:state", onChange);
  return () => window.removeEventListener("bbvoice:state", onChange);
}

export function toggleVoice(threadId: string): void {
  shell().ReactNativeWebView?.postMessage(JSON.stringify({ type: "bbvoice.toggle", threadId }));
}
