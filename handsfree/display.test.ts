// Run with `npm test` (vitest globals; the plugin has no installed test deps).
import type { VoiceSnapshot } from "@aj47/bb-voice-core";
import { bannerView, paint, PHASE_LABEL, shellButtonState } from "./display";

const snap = (patch: Partial<VoiceSnapshot>): VoiceSnapshot => ({ phase: "listening", partial: "", log: [], error: null, micMuted: false, question: null, queued: 0, ...patch });
const asking = snap({ phase: "asking", question: "Which color should I use?" });

function fakeButton() {
  const attrs: Record<string, string> = {};
  return { dataset: {} as DOMStringMap, title: "", attrs, setAttribute: (k: string, v: string) => void (attrs[k] = v) };
}

describe("desktop voice bar", () => {
  it("shows the agent's question under the phase", () => {
    expect(bannerView({ mode: "live", hasSession: true, snapshot: asking }, false)).toEqual({
      phase: "asking",
      title: "Agent has a question · answer out loud · GPT-Live",
      detail: "Agent asks: Which color should I use?",
      muted: false,
      canMute: true,
    });
  });

  it("shows the question in Free mode and on the new-thread composer too", () => {
    expect(bannerView({ mode: "classic", hasSession: true, snapshot: asking }, true).detail).toBe("Agent asks: Which color should I use?");
  });

  it("shows what the user is saying while they answer", () => {
    expect(bannerView({ mode: "live", hasSession: true, snapshot: { ...asking, phase: "hearing", partial: "the blue" } }, false).detail).toBe("the blue");
  });

  it("says when messages are queued rather than delivered", () => {
    expect(bannerView({ mode: "live", hasSession: true, snapshot: snap({ phase: "thinking", queued: 2 }) }, false)).toMatchObject({
      title: "Agent working · GPT-Live",
      detail: "2 messages queued for the agent",
    });
  });

  it("keeps errors and the mute state", () => {
    const v = bannerView({ mode: "live", hasSession: true, snapshot: { ...asking, phase: "error", error: "Voice connection dropped", micMuted: true } }, false);
    expect(v).toMatchObject({ detail: "Voice connection dropped", muted: true, canMute: false, title: "Error · click to retry · Mic muted · GPT-Live" });
  });
});

describe("voice button", () => {
  it("has a label for every phase", () => {
    for (const label of Object.values(PHASE_LABEL)) expect(label).toMatch(/\S/);
  });

  it("paints the asking state on the desktop composer button", () => {
    const b = fakeButton();
    paint(b, true, "asking");
    expect(b.dataset).toEqual({ live: "true", phase: "asking" });
    expect(b.attrs["aria-label"]).toBe("Realtime voice: the agent has a question. Tap to stop");
    expect(b.title).toBe(b.attrs["aria-label"]);
  });

  it("lights the compact-layout button from the phone app's bridge state", () => {
    const state = { threadId: "thr_a", phase: "asking" as const, mode: "live" as const };
    expect(shellButtonState(state, "thr_a")).toEqual({ live: true, phase: "asking" });
    expect(shellButtonState(state, "thr_b")).toEqual({ live: false, phase: "off" });
    expect(shellButtonState(null, "thr_a")).toEqual({ live: false, phase: "off" });
    const b = fakeButton();
    const { live, phase } = shellButtonState(state, "thr_a");
    paint(b, live, phase);
    expect(b.dataset.phase).toBe("asking");
  });
});
