// Client-side speech: a single queue on top of window.speechSynthesis, or the
// BB Voice app's native speech (Android WebViews have no speechSynthesis), plus
// the shared "which threads are on" state the UI pieces read.
import { chunkForSpeech } from "./speech-text";

export interface SpeechOptions {
  rate: number;
  voice: string;
}

type Listener = () => void;

const synth: SpeechSynthesis | null =
  typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;

type ShellWindow = Window & {
  __BB_VOICE__?: { version: number };
  ReactNativeWebView?: { postMessage(message: string): void };
};
const SPEECH_EVENT = "bbvoice:speech";

/** True inside the BB Voice app, however old. */
export const inVoiceShell =
  typeof window !== "undefined" &&
  Boolean((window as ShellWindow).__BB_VOICE__ && (window as ShellWindow).ReactNativeWebView);

/** The app's WebView bridge, from the release that added native speech. */
const nativeSpeech =
  inVoiceShell && ((window as ShellWindow).__BB_VOICE__?.version ?? 0) >= 2
    ? (window as ShellWindow).ReactNativeWebView!
    : null;

export const speechSupported = nativeSpeech !== null || (!inVoiceShell && synth !== null);

let options: SpeechOptions = { rate: 1.1, voice: "" };
let speaking = false;
let unlocked = false;
/** Chunks waiting to be spoken. We feed the engine one at a time. */
let queue: string[] = [];
let current: object | null = null;
/** The native utterance in flight; the app reports back when it ends. */
let nativePending: { id: string; done: () => void } | null = null;
let nativeSeq = 0;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeSpeaking(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const isSpeaking = () => speaking;

export function setSpeechOptions(next: SpeechOptions) {
  options = next;
}

function pickVoice(): SpeechSynthesisVoice | null {
  if (synth === null) return null;
  const wanted = options.voice.trim().toLowerCase();
  const voices = synth.getVoices();
  if (wanted !== "") {
    const match = voices.find((voice) => voice.name.toLowerCase().includes(wanted));
    if (match) return match;
  }
  return null;
}

function setSpeaking(next: boolean) {
  if (speaking === next) return;
  speaking = next;
  emit();
}

if (nativeSpeech !== null) {
  window.addEventListener(SPEECH_EVENT, (event) => {
    const pending = nativePending;
    if (pending === null || (event as CustomEvent<{ id: string }>).detail?.id !== pending.id) return;
    nativePending = null;
    pending.done();
  });
}

function speakNext() {
  const chunk = queue.shift();
  if (chunk === undefined) {
    current = null;
    setSpeaking(false);
    return;
  }
  const token = {};
  const advance = () => {
    if (current === token) speakNext();
  };
  const rate = Math.min(3, Math.max(0.5, options.rate || 1));
  current = token;
  setSpeaking(true);
  if (nativeSpeech !== null) {
    const id = `${Date.now()}-${(nativeSeq += 1)}`;
    nativePending = { id, done: advance };
    nativeSpeech.postMessage(JSON.stringify({ type: "bbvoice.speak", id, text: chunk, rate }));
    return;
  }
  if (synth === null) return;
  const utterance = new SpeechSynthesisUtterance(chunk);
  const voice = pickVoice();
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }
  utterance.rate = rate;
  utterance.onend = advance;
  utterance.onerror = advance;
  synth.speak(utterance);
}

/** Queue text to be read after whatever is already playing. */
export function enqueue(text: string) {
  if (!speechSupported) return;
  const chunks = chunkForSpeech(text);
  if (chunks.length === 0) return;
  queue.push(...chunks);
  if (current === null) speakNext();
}

/** Stop now and drop anything queued. */
export function stopSpeaking() {
  queue = [];
  current = null;
  nativePending = null;
  if (nativeSpeech !== null) {
    if (speaking) nativeSpeech.postMessage(JSON.stringify({ type: "bbvoice.speakStop" }));
  } else {
    synth?.cancel();
  }
  setSpeaking(false);
}

/**
 * iOS (and some Android browsers) only allow speech that was first started
 * inside a user gesture. Call this from any tap; it speaks an empty utterance
 * once so later messages can play on their own.
 */
export function unlockSpeech() {
  if (synth === null || unlocked) return;
  unlocked = true;
  const primer = new SpeechSynthesisUtterance(" ");
  primer.volume = 0;
  synth.speak(primer);
}

// ---------------------------------------------------------------------------
// Which threads have read-aloud on (mirrors the server; shared by every UI).

let enabledThreads = new Set<string>();
const enabledListeners = new Set<Listener>();

export function subscribeEnabled(listener: Listener) {
  enabledListeners.add(listener);
  return () => enabledListeners.delete(listener);
}
export const getEnabled = () => enabledThreads;

export function replaceEnabled(threadIds: readonly string[]) {
  enabledThreads = new Set(threadIds);
  for (const listener of enabledListeners) listener();
}
export function setThreadEnabled(threadId: string, on: boolean) {
  if (enabledThreads.has(threadId) === on) return;
  const next = new Set(enabledThreads);
  if (on) next.add(threadId);
  else next.delete(threadId);
  enabledThreads = next;
  for (const listener of enabledListeners) listener();
}
