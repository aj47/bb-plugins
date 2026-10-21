// The desktop voice session: one per bb window, kept outside React so it
// survives composer remounts and navigation. Mirrors the bb voice app's shell.
import {
  BbClient,
  ClassicSession,
  DEFAULT_SETTINGS,
  LiveSession,
  threadLabel,
  type LiveSessionConfig,
  type VoiceEngine,
  type VoiceMode,
  type VoicePrefs,
  type VoiceSnapshot,
} from "@aj47/bb-voice-core";
import { useSyncExternalStore } from "react";
import { classicPlatform, livePlatform, type Transcribe } from "./desktop";

export type VoiceDeps = {
  prefs: VoicePrefs;
  hasApiKey(): Promise<boolean>;
  transcribe: Transcribe;
  negotiate(offerSdp: string, session: LiveSessionConfig): Promise<string>;
  // The live voice can move itself to another thread (switch_thread / new_thread).
  onThreadChange(threadId: string): void;
};

export type VoiceState = {
  threadId: string;
  title: string;
  mode: VoiceMode;
  session: VoiceEngine | null;
  snapshot: VoiceSnapshot | null;
};

let state: VoiceState | null = null;
const listeners = new Set<() => void>();

function set(next: VoiceState | null) {
  state = next;
  listeners.forEach((fn) => fn());
}

export function useVoiceState() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}

const client = () => new BbClient(location.origin);

export function stopVoice() {
  const current = state;
  set(null);
  current?.session?.stop();
}

export function toggleVoice(threadId: string, deps: VoiceDeps) {
  if (state?.threadId === threadId) stopVoice();
  else void startVoice(threadId, deps);
}

async function startVoice(threadId: string, deps: VoiceDeps) {
  stopVoice();
  const bb = client();
  let title = threadId;
  try {
    title = threadLabel(await bb.getThread(threadId));
  } catch {}
  const { mode } = deps.prefs;

  if (mode === "live" && !(await deps.hasApiKey())) {
    const error = "Add an OpenAI API key: right-click the voice button, or switch to Free mode.";
    set({ threadId, title, mode, session: null, snapshot: { phase: "error", partial: "", log: [], error } });
    return;
  }

  const session: VoiceEngine =
    mode === "live"
      ? new LiveSession(
          livePlatform(deps.negotiate),
          bb,
          threadId,
          title,
          { model: deps.prefs.liveModel, voice: deps.prefs.liveVoice, delegateModel: deps.prefs.delegateModel },
          (nextId, nextTitle) => {
            if (state?.session !== session) return;
            set({ ...state, threadId: nextId, title: nextTitle });
            deps.onThreadChange(nextId);
          },
        )
      : new ClassicSession(classicPlatform(deps.transcribe), bb, threadId, DEFAULT_SETTINGS, title);

  set({ threadId, title, mode, session, snapshot: null });
  session.subscribe((snapshot) => {
    if (state?.session === session) set({ ...state, snapshot });
  });
  await session.start();
}

// Click on the bar: cut off speech, or resume a session that stopped or failed.
export function nudgeVoice() {
  const s = state?.session;
  if (!s) return;
  const phase = state?.snapshot?.phase ?? "off";
  if (!s.interrupt() && (phase === "off" || phase === "error")) void s.start();
}
