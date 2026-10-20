// Puts a "realtime voice" button next to bb's dictation mic in thread
// composers, inside the bb voice app only. bb's composer action slot is hidden
// in compact (phone) layout, so a content script places the button instead,
// anchored on the composer's submit/voice button.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { getVoiceState, inVoiceShell, openVoiceSettings, subscribeVoiceState, toggleVoice, type VoicePhase } from "./bridge";

const ANCHOR = "button[data-promptbox-submit-action]";
const MARK = "data-bbvoice-realtime";

const PHASE_LABEL: Record<VoicePhase, string> = {
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
`;

function openThreadId(): string | null {
  return location.pathname.match(/\/threads\/(thr_[a-z0-9]+)/)?.[1] ?? null;
}

function render(button: HTMLButtonElement) {
  const threadId = openThreadId();
  const state = getVoiceState();
  const live = Boolean(state && state.threadId === threadId && state.phase !== "off");
  const phase: VoicePhase = live && state ? state.phase : "off";
  button.dataset.live = String(live);
  button.dataset.phase = phase;
  button.setAttribute("aria-pressed", String(live));
  button.setAttribute("aria-label", PHASE_LABEL[phase]);
}

function makeButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute(MARK, "");
  // Same geometry as bb's dictation button, ghost-styled so it doesn't compete with it.
  button.className =
    "inline-flex cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring relative size-8 p-0 max-md:pointer-coarse:size-10 mr-1";
  button.innerHTML = ICON;
  // Tap toggles the session; long-press opens voice settings (mode, key, voice).
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressed = false;
  const clearPress = () => {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
  };
  button.addEventListener("pointerdown", () => {
    longPressed = false;
    clearPress();
    pressTimer = setTimeout(() => {
      longPressed = true;
      openVoiceSettings();
    }, 550);
  });
  button.addEventListener("pointerup", clearPress);
  button.addEventListener("pointercancel", clearPress);
  button.addEventListener("pointerleave", clearPress);
  button.addEventListener("contextmenu", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (longPressed) return;
    const threadId = openThreadId();
    if (threadId) toggleVoice(threadId);
  });
  render(button);
  return button;
}

function placeButtons() {
  const inThread = openThreadId() !== null;
  for (const anchor of Array.from(document.querySelectorAll(ANCHOR))) {
    const slot = anchor.parentElement; // span.relative.inline-flex
    const row = slot?.parentElement;
    if (!slot || !row) continue;
    const existing = row.querySelector(`[${MARK}]`) as HTMLButtonElement | null;
    if (!inThread) {
      existing?.remove();
      continue;
    }
    if (existing) render(existing);
    else row.insertBefore(makeButton(), slot);
  }
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "realtime-voice-button",
    mount({ signal }) {
      if (!inVoiceShell()) return;
      const style = document.createElement("style");
      style.textContent = CSS;
      document.head.appendChild(style);

      let queued = false;
      const schedule = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          placeButtons();
        });
      };
      const observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true, subtree: true });
      const unsubscribe = subscribeVoiceState(schedule);
      window.addEventListener("popstate", schedule, { signal });
      placeButtons();

      return () => {
        observer.disconnect();
        unsubscribe();
        style.remove();
        document.querySelectorAll(`[${MARK}]`).forEach((el) => el.remove());
      };
    },
  });
});
