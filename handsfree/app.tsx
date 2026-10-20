import { useSyncExternalStore } from "react";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { getVoiceState, inVoiceShell, subscribeVoiceState, toggleVoice, type VoicePhase } from "./bridge";

const PHASE_LABEL: Record<VoicePhase, string> = {
  off: "Start hands-free",
  listening: "Hands-free: listening",
  hearing: "Hands-free: hearing you",
  thinking: "Hands-free: agent working",
  speaking: "Hands-free: speaking",
  error: "Hands-free: error",
};

function HandsFreeButton({ threadId }: { threadId: string }) {
  const state = useSyncExternalStore(subscribeVoiceState, getVoiceState, () => null);
  if (!inVoiceShell()) return null;

  const active = state?.threadId === threadId && state.phase !== "off";
  const phase: VoicePhase = active ? state.phase : "off";
  const label = active ? `${PHASE_LABEL[phase]} (tap to stop)` : PHASE_LABEL.off;

  return (
    <Button
      variant="ghost"
      size="icon"
      className={`h-7 w-7 ${active ? "text-emerald-500" : ""} ${phase === "error" ? "text-destructive" : ""}`}
      aria-label={label}
      aria-pressed={active}
      onClick={() => toggleVoice(threadId)}
    >
      <Icon name="Mic" className="size-4" />
    </Button>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({
    id: "handsfree",
    title: "Hands-free voice",
    component: ({ threadId }) => <HandsFreeButton threadId={threadId} />,
  });
});
