// What the voice button and voice bar show, apart from React so it can be
// tested: the desktop composer button and banner, and the button the content
// script places in the bb voice app's compact layout.
import { PHASE_NOTIFICATION, statusDetail, type BridgeState, type Phase, type VoiceMode, type VoiceSnapshot } from "@aj47/bb-voice-core";

export const PHASE_LABEL: Record<Phase, string> = {
  off: "Start realtime voice (long-press for settings)",
  listening: "Realtime voice: listening. Tap to stop",
  hearing: "Realtime voice: hearing you. Tap to stop",
  thinking: "Realtime voice: agent working. Tap to stop",
  asking: "Realtime voice: the agent has a question. Tap to stop",
  speaking: "Realtime voice: speaking. Tap to stop",
  error: "Realtime voice: error. Tap to stop",
};

export const BAR_LABEL: Record<Phase, string> = {
  ...PHASE_NOTIFICATION,
  off: "Off · click to resume",
  asking: "Agent has a question · answer out loud",
  speaking: "Speaking · click to interrupt",
  error: "Error · click to retry",
};

export const NEW_THREAD_LABEL: Record<Phase, string> = {
  ...BAR_LABEL,
  listening: "Listening · say the first message for a new thread",
  thinking: "Starting a new thread",
};

type Paintable = { dataset: DOMStringMap; title: string; setAttribute(name: string, value: string): void };

export function paint(button: Paintable, live: boolean, phase: Phase) {
  button.dataset.live = String(live);
  button.dataset.phase = phase;
  button.setAttribute("aria-pressed", String(live));
  button.setAttribute("aria-label", PHASE_LABEL[phase]);
  button.title = PHASE_LABEL[phase];
}

// The compact-layout button: lit while the app's session is on this thread
// (threadId null: the new-thread composer).
export function shellButtonState(state: BridgeState | null, threadId: string | null): { live: boolean; phase: Phase } {
  const live = Boolean(state && state.threadId === threadId && state.phase !== "off");
  return { live, phase: live && state ? state.phase : "off" };
}

export type BannerView = { phase: Phase; title: string; detail: string; muted: boolean; canMute: boolean };

// The desktop voice bar above the composer.
export function bannerView(
  voice: { mode: VoiceMode; hasSession: boolean; snapshot: VoiceSnapshot | null },
  isNewThread: boolean,
): BannerView {
  const labels = isNewThread ? NEW_THREAD_LABEL : BAR_LABEL;
  const snap = voice.snapshot;
  const phase = snap?.phase ?? "thinking";
  const muted = Boolean(snap?.micMuted);
  const mode = voice.mode === "live" ? "GPT-Live" : "Free";
  return {
    phase,
    title: `${voice.hasSession ? labels[phase] : "Setup needed"}${muted ? " · Mic muted" : ""} · ${mode}`,
    detail: snap ? statusDetail(snap) : "",
    muted,
    canMute: voice.hasSession && phase !== "off" && phase !== "error",
  };
}
