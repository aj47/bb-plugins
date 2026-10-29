// Puts a "realtime voice" button next to bb's dictation mic in thread
// composers.
//
// Inside the bb voice mobile app the button hands the thread to the app's
// native loop. bb's composer action slot is hidden in compact (phone) layout,
// so a content script places that button, anchored on the composer's
// submit/voice button.
//
// Everywhere else (the desktop app, a browser) the button is a composer action
// that runs the same voice engines in the page, with a voice bar banner and a
// quick-settings popup.
//
// A GPT-Live session's spoken conversation is stored per thread by the plugin
// server and shown above the thread composer, since bb's timeline only holds
// agent turns.
//
// On the new-thread composer the same button starts a session with no thread:
// the first thing said becomes the first message of a new thread, which then opens.
import { PHASE_NOTIFICATION, LIVE_VOICES, type Phase, type VoiceMode } from "@aj47/bb-voice-core";
import { definePluginApp, useBbNavigate, useComposer, useRealtime, useRpc, useSdk, useSettings } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  getVoiceState,
  inVoiceShell,
  openVoiceSettings,
  subscribeVoiceState,
  toggleNewThreadVoice as toggleShellNewThreadVoice,
  toggleVoice as toggleShellVoice,
} from "./bridge";
import type { rpcContract } from "./server";
import { nudgeVoice, setVoiceMicMuted, stopVoice, toggleNewThreadVoice, toggleVoice, useVoiceState, type VoiceDeps } from "./voice";

const ANCHOR = "button[data-promptbox-submit-action]";
const MARK = "data-bbvoice-realtime";
const SETTINGS_POPUP = "voice-settings";
const LONG_PRESS_MS = 550;
const TRANSCRIPT_CHANNEL = "transcript"; // server.ts publishes on it after each append

const PHASE_LABEL: Record<Phase, string> = {
  off: "Start realtime voice (long-press for settings)",
  listening: "Realtime voice: listening. Tap to stop",
  hearing: "Realtime voice: hearing you. Tap to stop",
  thinking: "Realtime voice: agent working. Tap to stop",
  speaking: "Realtime voice: speaking. Tap to stop",
  error: "Realtime voice: error. Tap to stop",
};

// Four rounded bars in bb's 1.5px stroke style; they bounce while live.
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" class="size-5" data-icon-root="" aria-hidden="true">
  <path class="bbv-bar" d="M5 10v4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
  <path class="bbv-bar" d="M9.67 6v12" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
  <path class="bbv-bar" d="M14.33 8v8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
  <path class="bbv-bar" d="M19 10.5v3" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
</svg>`;

const MIC_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>
</svg>`;
const MIC_OFF_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M15 9.4V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 5.1 2.1M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18"/>
</svg>`;

// Same geometry as bb's dictation button, ghost-styled so it doesn't compete with it.
const BUTTON_CLASS =
  "inline-flex cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring relative size-8 p-0 max-md:pointer-coarse:size-10";

const CSS = `
[${MARK}] { transition: background-color 150ms, color 150ms; }
[${MARK}][data-live="true"] { background-color: rgb(16 185 129 / 0.18); color: rgb(52 211 153); }
[${MARK}][data-phase="speaking"] { background-color: rgb(59 130 246 / 0.2); color: rgb(96 165 250); }
[${MARK}][data-phase="thinking"] { background-color: rgb(245 158 11 / 0.18); color: rgb(251 191 36); }
[${MARK}][data-phase="error"] { background-color: rgb(239 68 68 / 0.18); color: rgb(248 113 113); }
[${MARK}] .bbv-bar { transform-box: fill-box; transform-origin: center; }
[${MARK}][data-live="true"] .bbv-bar { animation: bbv-bounce 900ms ease-in-out infinite; }
[${MARK}][data-live="true"] .bbv-bar:nth-child(2) { animation-delay: -300ms; }
[${MARK}][data-live="true"] .bbv-bar:nth-child(3) { animation-delay: -600ms; }
[${MARK}][data-live="true"] .bbv-bar:nth-child(4) { animation-delay: -150ms; }
[${MARK}][data-phase="thinking"] .bbv-bar { animation-duration: 1800ms; }
@keyframes bbv-bounce { 0%, 100% { transform: scaleY(0.55); } 50% { transform: scaleY(1.15); } }
@media (prefers-reduced-motion: reduce) { [${MARK}] .bbv-bar { animation: none !important; } }

.bbv-banner { display: flex; align-items: center; gap: 10px; padding: 6px 8px 6px 12px; border-radius: 10px; font-size: 13px;
  background: var(--bbv-tint); border: 1px solid var(--bbv-edge); }
.bbv-banner[data-phase="listening"], .bbv-banner[data-phase="hearing"] { --bbv-tint: rgb(16 185 129 / 0.12); --bbv-edge: rgb(16 185 129 / 0.3); }
.bbv-banner[data-phase="thinking"] { --bbv-tint: rgb(245 158 11 / 0.12); --bbv-edge: rgb(245 158 11 / 0.3); }
.bbv-banner[data-phase="speaking"] { --bbv-tint: rgb(59 130 246 / 0.12); --bbv-edge: rgb(59 130 246 / 0.3); }
.bbv-banner[data-phase="error"] { --bbv-tint: rgb(239 68 68 / 0.12); --bbv-edge: rgb(239 68 68 / 0.3); }
.bbv-banner[data-phase="off"] { --bbv-tint: rgb(127 127 127 / 0.1); --bbv-edge: rgb(127 127 127 / 0.25); }
.bbv-banner-main { flex: 1; min-width: 0; text-align: left; cursor: pointer; background: none; border: 0; color: inherit; padding: 0; }
.bbv-banner-phase { font-weight: 600; }
.bbv-banner-sub { opacity: 0.75; font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bbv-banner[data-muted="true"] { --bbv-tint: rgb(127 127 127 / 0.12); --bbv-edge: rgb(127 127 127 / 0.35); }
.bbv-banner-mic { width: 26px; height: 26px; border-radius: 6px; border: 0; background: rgb(127 127 127 / 0.15); color: inherit; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; }
.bbv-banner-mic[aria-checked="true"] { background: rgb(220 38 38 / 0.85); color: white; }
.bbv-banner-stop { width: 26px; height: 26px; border-radius: 6px; border: 0; background: rgb(127 127 127 / 0.15); color: inherit; cursor: pointer; }

.bbv-transcript { border-radius: 10px; border: 1px solid rgb(127 127 127 / 0.25); font-size: 13px; overflow: hidden; }
.bbv-transcript-head { display: flex; width: 100%; align-items: center; gap: 8px; padding: 6px 10px; background: none; border: 0; color: inherit;
  cursor: pointer; font-weight: 600; opacity: 0.85; text-align: left; }
.bbv-transcript-head span:last-child { margin-left: auto; font-weight: 400; opacity: 0.7; }
.bbv-transcript-body { display: flex; flex-direction: column; gap: 6px; padding: 4px 10px 10px; max-height: 35vh; overflow-y: auto; }
.bbv-turn { max-width: 85%; padding: 6px 10px; border-radius: 12px; line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; }
.bbv-turn[data-role="user"] { align-self: flex-end; background: rgb(127 127 127 / 0.18); border-bottom-right-radius: 4px; }
.bbv-turn[data-role="assistant"] { align-self: flex-start; background: rgb(16 185 129 / 0.14); border-bottom-left-radius: 4px; }
.bbv-turn-who { display: block; font-size: 11px; opacity: 0.6; margin-bottom: 1px; }

.bbv-settings { display: flex; flex-direction: column; gap: 10px; padding: 12px; width: 300px; font-size: 13px; }
.bbv-settings label { display: flex; flex-direction: column; gap: 4px; opacity: 0.9; }
.bbv-settings select, .bbv-settings input { padding: 6px 8px; border-radius: 6px; border: 1px solid rgb(127 127 127 / 0.3); background: transparent; color: inherit; }
.bbv-settings button { padding: 6px 10px; border-radius: 6px; border: 0; background: rgb(16 185 129 / 0.85); color: white; cursor: pointer; font-weight: 600; }
.bbv-settings .bbv-muted { opacity: 0.65; font-size: 12px; }
`;

// Tap toggles the session; long-press or right-click opens voice settings.
function bindPress(button: HTMLElement, onTap: () => void, onSettings: () => void, signal: AbortSignal) {
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressed = false;
  const clearPress = () => {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
  };
  const opts = { signal };
  button.addEventListener("pointerdown", () => {
    longPressed = false;
    clearPress();
    pressTimer = setTimeout(() => {
      longPressed = true;
      onSettings();
    }, LONG_PRESS_MS);
  }, opts);
  button.addEventListener("pointerup", clearPress, opts);
  button.addEventListener("pointercancel", clearPress, opts);
  button.addEventListener("pointerleave", clearPress, opts);
  button.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    clearPress();
    if (!longPressed) onSettings();
    longPressed = true;
  }, opts);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (longPressed) return;
    onTap();
  }, opts);
}

function paint(button: HTMLElement, live: boolean, phase: Phase) {
  button.dataset.live = String(live);
  button.dataset.phase = phase;
  button.setAttribute("aria-pressed", String(live));
  button.setAttribute("aria-label", PHASE_LABEL[phase]);
  button.title = PHASE_LABEL[phase];
}

// ---- bb voice mobile shell -------------------------------------------------------

function openThreadId(): string | null {
  return location.pathname.match(/\/threads\/(thr_[a-z0-9]+)/)?.[1] ?? null;
}

// The new-thread composer's project, recorded by its voice banner (null: bb picks the latest).
let newThreadProjectId: string | null = null;

// Off a thread page the button starts a new thread; a pending one has threadId null.
function renderShellButton(button: HTMLButtonElement) {
  const threadId = openThreadId();
  const state = getVoiceState();
  const live = Boolean(state && state.threadId === threadId && state.phase !== "off");
  paint(button, live, live && state ? state.phase : "off");
  if (!threadId) {
    const label = live ? "New-thread voice: say your first message. Tap to stop" : "Start realtime voice in a new thread";
    button.setAttribute("aria-label", label);
    button.title = label;
  }
}

function makeShellButton(signal: AbortSignal): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute(MARK, "");
  button.className = `${BUTTON_CLASS} mr-1`;
  button.innerHTML = ICON;
  bindPress(
    button,
    () => {
      const threadId = openThreadId();
      if (threadId) toggleShellVoice(threadId);
      else toggleShellNewThreadVoice(newThreadProjectId);
    },
    openVoiceSettings,
    signal,
  );
  renderShellButton(button);
  return button;
}

// One button beside each composer's submit/voice button. bb reuses composer DOM
// across pages, so any other button (nested deeper or in an outer row) is stale.
function placeShellButtons(signal: AbortSignal) {
  const placed = new Set<Element>();
  for (const anchor of Array.from(document.querySelectorAll(ANCHOR))) {
    const slot = anchor.parentElement; // span.relative.inline-flex
    const row = slot?.parentElement;
    if (!slot || !row) continue;
    let button = Array.from(row.children).find((el) => el.hasAttribute(MARK)) as HTMLButtonElement | undefined;
    if (button) renderShellButton(button);
    else row.insertBefore((button = makeShellButton(signal)), slot);
    placed.add(button);
  }
  document.querySelectorAll(`[${MARK}]`).forEach((el) => placed.has(el) || el.remove());
}

function mountShell(signal: AbortSignal) {
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      placeShellButtons(signal);
    });
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  const unsubscribe = subscribeVoiceState(schedule);
  window.addEventListener("popstate", schedule, { signal });
  placeShellButtons(signal);
  return () => {
    observer.disconnect();
    unsubscribe();
    document.querySelectorAll(`[${MARK}]`).forEach((el) => el.remove());
  };
}

// ---- desktop: voice in the page ---------------------------------------------------

function useVoiceDeps(): () => VoiceDeps {
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const { values } = useSettings();
  return () => ({
    prefs: {
      mode: values?.mode === "classic" ? "classic" : "live",
      liveModel: String(values?.liveModel ?? ""),
      liveVoice: String(values?.liveVoice ?? ""),
      delegateModel: String(values?.delegateModel ?? ""),
      threadModel: String(values?.threadModel ?? ""),
    },
    hasApiKey: async () => (await rpc.call("status")).hasApiKey,
    transcribe: async (file) => (await sdk.system.transcribeVoice({ file })).text,
    negotiate: async (offerSdp, session) => (await rpc.call("live.negotiate", { offerSdp, session })).answerSdp,
    onThreadChange: (threadId) => navigate.toThread(threadId),
  });
}

// The thread a composer talks to; null for the new-thread composer.
function threadScope(composer: ReturnType<typeof useComposer>) {
  return composer.scope.kind === "thread" ? composer.scope.threadId : null;
}

function newThreadProject(composer: ReturnType<typeof useComposer>) {
  return composer.scope.kind === "new-thread" ? composer.scope.projectId : null;
}

function RealtimeButton() {
  const composer = useComposer();
  const voice = useVoiceState();
  const deps = useVoiceDeps();
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const composerRef = useRef(composer);
  composerRef.current = composer;
  const ref = useRef<HTMLButtonElement>(null);
  const threadId = threadScope(composer);
  const live = Boolean(voice && voice.threadId === threadId);
  const phase: Phase = live ? (voice?.snapshot?.phase ?? "thinking") : "off";

  useEffect(() => {
    const button = ref.current;
    if (!button) return;
    const controller = new AbortController();
    bindPress(
      button,
      () => {
        const c = composerRef.current;
        if (threadId) toggleVoice(threadId, depsRef.current());
        else toggleNewThreadVoice(newThreadProject(c), depsRef.current());
      },
      () => composerRef.current.experimental_openPopup(SETTINGS_POPUP),
      controller.signal,
    );
    return () => controller.abort();
  }, [threadId]);

  useEffect(() => {
    if (ref.current) paint(ref.current, live, phase);
  }, [live, phase]);

  if (inVoiceShell()) return null;
  return <button ref={ref} type="button" {...{ [MARK]: "" }} className={BUTTON_CLASS} dangerouslySetInnerHTML={{ __html: ICON }} />;
}

const BAR_LABEL: Record<Phase, string> = {
  ...PHASE_NOTIFICATION,
  off: "Off · click to resume",
  speaking: "Speaking · click to interrupt",
  error: "Error · click to retry",
};

const NEW_THREAD_LABEL: Record<Phase, string> = {
  ...BAR_LABEL,
  listening: "Listening · say the first message for a new thread",
  thinking: "Starting a new thread",
};

// In the voice app, the new-thread composer's banner records the project and
// opens the thread once the first message creates it; the app only reports the id.
function useShellNewThread(composer: ReturnType<typeof useComposer>) {
  const shellState = useSyncExternalStore(subscribeVoiceState, getVoiceState);
  const navigate = useBbNavigate();
  const pending = useRef(false);
  const isNew = composer.scope.kind === "new-thread";
  const projectId = newThreadProject(composer);
  useEffect(() => {
    if (isNew) newThreadProjectId = projectId;
  }, [isNew, projectId]);
  useEffect(() => {
    if (!isNew || !inVoiceShell()) return;
    if (shellState && shellState.threadId === null && shellState.phase !== "off") pending.current = true;
    else if (pending.current) {
      pending.current = false;
      if (shellState?.threadId) navigate.toThread(shellState.threadId);
    }
  }, [isNew, shellState, navigate]);
  return isNew && shellState?.threadId === null && shellState.phase !== "off" ? shellState : null;
}

function VoiceBanner() {
  const composer = useComposer();
  const voice = useVoiceState();
  const shellPending = useShellNewThread(composer);
  const threadId = threadScope(composer);
  if (shellPending) {
    return (
      <div className="bbv-banner" data-phase={shellPending.phase}>
        <div className="bbv-banner-main">
          <div className="bbv-banner-phase">{NEW_THREAD_LABEL[shellPending.phase]}</div>
        </div>
        <button type="button" className="bbv-banner-stop" onClick={() => toggleShellNewThreadVoice(null)} aria-label="Stop realtime voice">
          ✕
        </button>
      </div>
    );
  }
  if (!voice || voice.threadId !== threadId || inVoiceShell()) return null;
  const labels = threadId ? BAR_LABEL : NEW_THREAD_LABEL;
  const phase = voice.snapshot?.phase ?? "thinking";
  const sub = voice.snapshot?.error ?? voice.snapshot?.partial ?? "";
  const mode = voice.mode === "live" ? "GPT-Live" : "Free";
  const muted = Boolean(voice.snapshot?.micMuted);
  const canMute = Boolean(voice.session) && phase !== "off" && phase !== "error";
  return (
    <div className="bbv-banner" data-phase={phase} data-muted={String(muted)}>
      <button type="button" className="bbv-banner-main" onClick={nudgeVoice}>
        <div className="bbv-banner-phase">
          {voice.session ? labels[phase] : "Setup needed"}
          {muted ? " · Mic muted" : ""} · {mode}
        </div>
        {sub ? <div className="bbv-banner-sub">{sub}</div> : null}
      </button>
      {canMute ? (
        <button
          type="button"
          className="bbv-banner-mic"
          onClick={() => setVoiceMicMuted(!muted)}
          role="switch"
          aria-checked={muted}
          aria-label={muted ? "Unmute microphone" : "Mute microphone"}
          title={muted ? "Unmute microphone" : "Mute microphone"}
          dangerouslySetInnerHTML={{ __html: muted ? MIC_OFF_ICON : MIC_ICON }}
        />
      ) : null}
      <button type="button" className="bbv-banner-stop" onClick={stopVoice} aria-label="Stop realtime voice">
        ✕
      </button>
    </div>
  );
}

type TranscriptEntry = { role: "user" | "assistant"; text: string; at: number };

function VoiceTranscript() {
  const composer = useComposer();
  const rpc = useRpc<typeof rpcContract>();
  const threadId = threadScope(composer);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [open, setOpen] = useState(true);
  const body = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    if (!threadId) return;
    rpc.call("transcript.get", { threadId }).then((r) => setEntries(r.entries), () => {});
  }, [rpc, threadId]);

  useEffect(() => {
    setEntries([]);
    load();
  }, [load]);

  useRealtime(TRANSCRIPT_CHANNEL, (payload) => {
    if ((payload as { threadId?: string } | null)?.threadId === threadId) load();
  });

  useEffect(() => {
    if (open && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [entries, open]);

  if (!threadId || entries.length === 0) return null;
  return (
    <div className="bbv-transcript">
      <button type="button" className="bbv-transcript-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>Voice conversation</span>
        <span>
          {entries.length} {open ? "▾" : "▸"}
        </span>
      </button>
      {open ? (
        <div className="bbv-transcript-body" ref={body}>
          {entries.map((e, i) => (
            <div key={`${e.at}-${i}`} className="bbv-turn" data-role={e.role}>
              <span className="bbv-turn-who">{e.role === "user" ? "You" : "GPT-Live"}</span>
              {e.text}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function VoiceSettings() {
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const { values } = useSettings();
  const [mode, setMode] = useState<VoiceMode>(values?.mode === "classic" ? "classic" : "live");
  const [voice, setVoice] = useState(String(values?.liveVoice ?? LIVE_VOICES[0]));
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rpc.call("status").then((s) => setHasKey(s.hasApiKey), () => setHasKey(false));
  }, [rpc]);

  const save = useCallback(async () => {
    try {
      await rpc.call("settings.save", { mode, liveVoice: voice, openaiApiKey: key || undefined });
      composer.experimental_closePopup();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, [rpc, composer, mode, voice, key]);

  return (
    <div className="bbv-settings">
      <strong>Realtime voice</strong>
      <label>
        Mode
        <select value={mode} onChange={(e) => setMode(e.target.value as VoiceMode)}>
          <option value="live">GPT-Live (OpenAI)</option>
          <option value="classic">Free (bb transcription + system voice)</option>
        </select>
      </label>
      <div className="bbv-muted">
        {mode === "live"
          ? "GPT-Live talks with you and hands work to the bb agent. Billed per minute to your OpenAI key."
          : "Pause to send. Uses bb's voice transcription and your system voice."}
      </div>
      {mode === "live" ? (
        <>
          <label>
            OpenAI API key {hasKey ? "(saved; leave blank to keep)" : ""}
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={hasKey ? "••••••••" : "sk-..."} autoComplete="off" />
          </label>
          <label>
            Voice
            <select value={voice} onChange={(e) => setVoice(e.target.value)}>
              {LIVE_VOICES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}
      {error ? <div style={{ color: "rgb(248 113 113)" }}>{error}</div> : null}
      <button type="button" onClick={() => void save()}>
        Save
      </button>
      <div className="bbv-muted">Models are in Tools → Hands-free voice.</div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "realtime-voice-button",
    mount({ signal }) {
      const style = document.createElement("style");
      style.textContent = CSS;
      document.head.appendChild(style);
      const unmountShell = inVoiceShell() ? mountShell(signal) : null;
      return () => {
        unmountShell?.();
        stopVoice();
        style.remove();
      };
    },
  });

  app.composer.customize({
    id: "realtime-voice",
    scopes: ["thread", "new-thread"],
    actions: [{ id: "realtime-voice", component: RealtimeButton }],
    banners: [
      { id: "voice-transcript", chrome: "bare", component: VoiceTranscript },
      { id: "voice-bar", chrome: "bare", component: VoiceBanner },
    ],
    experimental_popups: [{ id: SETTINGS_POPUP, label: "Realtime voice settings", component: VoiceSettings }],
  });
});
