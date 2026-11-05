// Read Aloud — frontend.
//
// - A speaker button beside every thread composer toggles read-aloud for that
//   thread (also in the thread's actions menu). bb hides composer actions in
//   compact layout, so inside the BB Voice app a content script places it.
// - A read-aloud button in each message's action bar reads that one message.
// - An always-mounted listener speaks messages the server pushes, but only for
//   threads open on this device while the app is in the foreground.
// - Tapping any button (mic, send, …) or pressing Escape stops playback, so
//   dictating a reply never records the speech. Typing doesn't interrupt.
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import {
  definePluginApp,
  experimental_THREAD_ACTION_GROUPS,
  useBbContext,
  useComposer,
  useRealtime,
  useRpc,
  useSettings,
  useSidebarSplitLayout,
  type PluginRpcClient,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract, SpeakPayload, StatePayload } from "./server";
import {
  enqueue,
  getEnabled,
  inVoiceShell,
  isSpeaking,
  replaceEnabled,
  setSpeechOptions,
  setThreadEnabled,
  speechSupported,
  stopSpeaking,
  subscribeEnabled,
  subscribeSpeaking,
  unlockSpeech,
} from "./speaker";
import { toSpeech } from "./speech-text";
import { cn } from "@/lib/utils";

type Rpc = PluginRpcClient<typeof rpcContract>;

const useEnabledThreads = () => useSyncExternalStore(subscribeEnabled, getEnabled, getEnabled);
const useSpeaking = () => useSyncExternalStore(subscribeSpeaking, isSpeaking, isSpeaking);

async function toggle(rpc: Rpc, threadId: string, on: boolean) {
  // Runs inside the tap, which is what lets iOS play audio later on its own.
  unlockSpeech();
  setThreadEnabled(threadId, on);
  if (!on) stopSpeaking();
  try {
    await rpc.call("set_enabled", { threadId, enabled: on });
    if (on) enqueue("Read aloud on.");
  } catch (error) {
    setThreadEnabled(threadId, !on);
    toast.error(`Read aloud: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function replayLast(rpc: Rpc, threadId: string) {
  unlockSpeech();
  stopSpeaking();
  const { text } = await rpc.call("last_message", { threadId });
  if (text === null) toast("No reply to read yet.");
  else enqueue(text);
}

/** The message being read by its own button, so a second tap stops it. */
let playingMessageId: string | null = null;
let interruptedAt = 0;

function readMessage(id: string, markdown: string) {
  // The tap's pointerdown has already stopped playback, or this is a keyboard press.
  const stopping =
    playingMessageId === id && (isSpeaking() || Date.now() - interruptedAt < 1500);
  unlockSpeech();
  stopSpeaking();
  playingMessageId = null;
  if (stopping) return;
  if (!speechSupported) {
    toast.error(inVoiceShell ? "Update BB Voice to use read aloud." : "This browser can't read aloud.");
    return;
  }
  const text = toSpeech(markdown);
  if (text === "") {
    toast("Nothing to read in this message.");
    return;
  }
  playingMessageId = id;
  enqueue(text);
}

// --- Icons -----------------------------------------------------------------

function SpeakerIcon({ className, muted, waves }: { className?: string; muted?: boolean; waves?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      {muted ? (
        <>
          <line x1="22" y1="9" x2="16" y2="15" />
          <line x1="16" y1="9" x2="22" y2="15" />
        </>
      ) : (
        <>
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          {waves ? <path d="M19 5a10 10 0 0 1 0 14" /> : null}
        </>
      )}
    </svg>
  );
}

const toggleLabel = (on: boolean, speaking: boolean) =>
  speaking && on ? "Stop reading" : on ? "Turn off read aloud" : "Read replies aloud";

// --- Composer button ---------------------------------------------------------

function ComposerToggle() {
  const composer = useComposer();
  const rpc = useRpc<typeof rpcContract>();
  const enabled = useEnabledThreads();
  const speaking = useSpeaking();
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;

  // Sending a reply stops whatever is still being read.
  useEffect(() => composer.onSubmitted(() => stopSpeaking()), [composer]);

  // The app gets the content-script button instead: this slot is hidden there.
  if (threadId === null || !speechSupported || inVoiceShell) return null;
  const on = enabled.has(threadId);
  const label = toggleLabel(on, speaking);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={() => {
        // While talking, the first tap just stops the current message.
        if (speaking && on) {
          stopSpeaking();
          return;
        }
        void toggle(rpc, threadId, !on);
      }}
      data-read-aloud-toggle=""
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground",
        on && "text-primary hover:text-primary",
        speaking && on && "animate-pulse",
      )}
    >
      <SpeakerIcon className="size-4" muted={!on} waves={speaking && on} />
    </button>
  );
}

// --- Listener ------------------------------------------------------------------

/** Thread ids visible on this device right now. */
function useOpenThreadIds(): ReadonlySet<string> {
  const { threadId } = useBbContext();
  const layout = useSidebarSplitLayout();
  const ids = new Set<string>();
  if (layout !== null) {
    for (const pane of layout.panes) if (pane.threadId) ids.add(pane.threadId);
  }
  if (threadId) ids.add(threadId);
  return ids;
}

function Listener() {
  const rpc = useRpc<typeof rpcContract>();
  shellToggleRef.current = (threadId) => {
    if (isSpeaking() && getEnabled().has(threadId)) stopSpeaking();
    else void toggle(rpc, threadId, !getEnabled().has(threadId));
  };
  const settings = useSettings();
  const enabled = useEnabledThreads();
  const openIds = useOpenThreadIds();
  const spoken = useRef(new Set<string>());

  const mode = settings.values?.mode === "final" ? "final" : "all";
  const rate = Number(settings.values?.rate ?? 1.1);
  const voice = String(settings.values?.voice ?? "");
  useEffect(() => setSpeechOptions({ rate, voice }), [rate, voice]);

  const refresh = useCallback(() => {
    rpc.call("enabled_threads").then(({ threadIds }) => replaceEnabled(threadIds), () => {});
  }, [rpc]);
  useEffect(refresh, [refresh]);

  useEffect(() => {
    replayRef.current = (threadId) =>
      replayLast(rpc, threadId).catch((error) => {
        toast.error(`Read aloud: ${error instanceof Error ? error.message : String(error)}`);
      });
    return () => {
      replayRef.current = null;
    };
  }, [rpc]);

  // Keep the latest values for realtime handlers without resubscribing.
  const live = useRef({ enabled, openIds, mode });
  live.current = { enabled, openIds, mode };

  const shouldSpeak = (threadId: string) =>
    live.current.enabled.has(threadId) &&
    live.current.openIds.has(threadId) &&
    document.visibilityState === "visible";

  const say = (payload: SpeakPayload) => {
    if (spoken.current.has(payload.id)) return;
    spoken.current.add(payload.id);
    if (spoken.current.size > 500) spoken.current = new Set([...spoken.current].slice(-200));
    enqueue(payload.text);
  };

  useRealtime("speak", (raw) => {
    const payload = raw as SpeakPayload;
    if (live.current.mode !== "all" || !shouldSpeak(payload.threadId)) return;
    say(payload);
  });
  useRealtime("done", (raw) => {
    // In "every message" mode this is usually already spoken and skipped;
    // it still catches a final reply missed while the thread was loading.
    const payload = raw as SpeakPayload;
    if (!shouldSpeak(payload.threadId)) return;
    say(payload);
  });
  useRealtime("state", (raw) => {
    const { threadId, enabled: on } = raw as StatePayload;
    setThreadEnabled(threadId, on);
  });

  // Leaving the app or the thread stops playback; the setting stays on.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") stopSpeaking();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  const openKey = [...openIds].sort().join(",");
  useEffect(() => () => stopSpeaking(), [openKey]);

  return null;
}

// --- BB Voice app composer button ---------------------------------------------

const ANCHOR = "button[data-promptbox-submit-action]";
const MARK = "data-read-aloud-toggle";
const SPEAKER_PATH = `<path d="M11 5 6 9H3v6h3l5 4V5Z"/>`;
const WAVE_PATHS = `<path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>`;
const MUTE_PATHS = `<line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/>`;
const svg = (inner: string) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

const openThreadId = () => /\/threads\/([^/?#]+)/.exec(location.pathname)?.[1] ?? null;

function renderShellButton(button: HTMLButtonElement, threadId: string) {
  const on = getEnabled().has(threadId);
  const label = toggleLabel(on, isSpeaking());
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", String(on));
  button.title = label;
  button.classList.toggle("text-primary", on);
  button.classList.toggle("text-muted-foreground", !on);
  button.classList.toggle("animate-pulse", on && isSpeaking());
  const icon = on ? WAVE_PATHS : MUTE_PATHS;
  if (button.dataset.icon !== icon) {
    button.dataset.icon = icon;
    button.innerHTML = svg(SPEAKER_PATH + icon);
  }
}

// One button beside each thread composer's submit button. bb reuses composer DOM
// across pages, so anything not placed on this pass is stale.
function placeShellButtons(signal: AbortSignal) {
  const threadId = openThreadId();
  const placed = new Set<Element>();
  if (threadId !== null) {
    for (const anchor of Array.from(document.querySelectorAll(ANCHOR))) {
      const slot = anchor.parentElement;
      const row = slot?.parentElement;
      if (!slot || !row) continue;
      let button = Array.from(row.children).find((el) => el.hasAttribute(MARK)) as HTMLButtonElement | undefined;
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.setAttribute(MARK, "");
        button.className =
          "relative mr-1 inline-flex size-8 cursor-pointer items-center justify-center rounded-md p-0 max-md:pointer-coarse:size-10";
        button.addEventListener(
          "click",
          () => {
            const id = openThreadId();
            if (id !== null) shellToggleRef.current?.(id);
          },
          { signal },
        );
        row.insertBefore(button, slot);
      }
      renderShellButton(button, threadId);
      placed.add(button);
    }
  }
  document.querySelectorAll(`[${MARK}]`).forEach((el) => placed.has(el) || el.remove());
}

function mountShellButtons(signal: AbortSignal) {
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
  const unsubscribeEnabled = subscribeEnabled(schedule);
  const unsubscribeSpeaking = subscribeSpeaking(schedule);
  window.addEventListener("popstate", schedule, { signal });
  schedule();
  return () => {
    observer.disconnect();
    unsubscribeEnabled();
    unsubscribeSpeaking();
    document.querySelectorAll(`[${MARK}]`).forEach((el) => el.remove());
  };
}

// --- Registration ----------------------------------------------------------------

export default definePluginApp((app) => {
  app.experimental_icons.register({
    name: "read-aloud/on",
    component: ({ className }) => <SpeakerIcon className={className} />,
  });
  app.experimental_icons.register({
    name: "read-aloud/off",
    component: ({ className }) => <SpeakerIcon className={className} muted />,
  });

  app.slots.experimental_appOverlay({ id: "listener", component: Listener });

  app.slots.messageAction({
    id: "read-message",
    title: "Read aloud",
    icon: "read-aloud/on",
    run: ({ message, selectedText }) => readMessage(message.id, selectedText ?? message.text),
  });

  app.composer.customize({
    id: "read-aloud",
    scopes: ["thread"],
    actions: [{ id: "toggle", component: ComposerToggle }],
    plusMenu: [
      {
        id: "replay",
        label: "Read last reply aloud",
        icon: "read-aloud/on",
        run: ({ composer }) => {
          if (composer.scope.kind !== "thread") return;
          const threadId = composer.scope.threadId;
          void replayRef.current?.(threadId);
        },
      },
    ],
  });

  app.slots.experimental_threadAction({
    id: "toggle",
    title: "Read aloud",
    icon: "read-aloud/on",
    group: experimental_THREAD_ACTION_GROUPS.settings,
    useData: () => {
      const rpc = useRpc<typeof rpcContract>();
      const enabled = useEnabledThreads();
      return { rpc, enabled };
    },
    item: ({ thread, data }) => {
      if (!speechSupported) return null;
      const on = data.enabled.has(thread.id);
      return {
        label: on ? "Stop reading aloud" : "Read replies aloud",
        icon: on ? "read-aloud/off" : "read-aloud/on",
        run: () => toggle(data.rpc, thread.id, !on),
      };
    },
  });

  // Tapping any button (the mic included) interrupts playback so dictation
  // doesn't pick the speech up. Any tap also unlocks iOS audio.
  app.contentScripts.register({
    id: "interrupt",
    mount({ signal }) {
      const onPointer = (event: PointerEvent) => {
        unlockSpeech();
        if (!isSpeaking()) return;
        const target = event.target as Element | null;
        if (target?.closest("[data-read-aloud-toggle]")) return;
        if (target?.closest("button, [role=button]")) {
          interruptedAt = Date.now();
          stopSpeaking();
        }
      };
      const onKey = (event: KeyboardEvent) => {
        if (event.key === "Escape" && isSpeaking()) stopSpeaking();
      };
      document.addEventListener("pointerdown", onPointer, { signal, capture: true });
      document.addEventListener("keydown", onKey, { signal, capture: true });
      const unmountShellButtons = inVoiceShell ? mountShellButtons(signal) : undefined;
      return () => {
        unmountShellButtons?.();
        stopSpeaking();
      };
    },
  });
});

// The plus-menu `run` has no hooks, so the listener lends it an RPC client.
const replayRef: { current: ((threadId: string) => Promise<void>) | null } = { current: null };
// The content-script button has no hooks either.
const shellToggleRef: { current: ((threadId: string) => void) | null } = { current: null };
