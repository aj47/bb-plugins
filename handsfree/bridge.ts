// Bridge to the bb voice mobile shell, which loads bb's web UI in a WebView
// and owns the native hands-free loop (foreground service, works locked).
// The protocol types live in @aj47/bb-voice-core, shared with the shell.
import { STATE_EVENT, type BridgeMessage, type BridgeState } from "@aj47/bb-voice-core";

type ShellWindow = Window & {
  __BB_VOICE__?: { version: number; state: BridgeState | null };
  ReactNativeWebView?: { postMessage(message: string): void };
};

const shell = () => window as ShellWindow;

export function inVoiceShell(): boolean {
  const w = shell();
  return Boolean(w.__BB_VOICE__ && w.ReactNativeWebView);
}

export function getVoiceState(): BridgeState | null {
  return shell().__BB_VOICE__?.state ?? null;
}

export function subscribeVoiceState(onChange: () => void): () => void {
  window.addEventListener(STATE_EVENT, onChange);
  return () => window.removeEventListener(STATE_EVENT, onChange);
}

function post(message: BridgeMessage) {
  shell().ReactNativeWebView?.postMessage(JSON.stringify(message));
}

export function toggleVoice(threadId: string): void {
  post({ type: "bbvoice.toggle", threadId });
}

export function toggleNewThreadVoice(projectId: string | null): void {
  post({ type: "bbvoice.newThread", projectId });
}

export function openVoiceSettings(): void {
  post({ type: "bbvoice.settings" });
}
