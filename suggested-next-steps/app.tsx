// bb-plugin-suggested-next-steps — frontend entry.
//
// Renders ```next-steps fences in assistant messages as buttons. Click sends
// the suggestion; Alt/Option-click (or a non-empty draft) inserts it into the
// composer instead so nothing the user typed is lost.
import { useState } from "react";
import type { MouseEvent } from "react";
import { definePluginApp, useComposer } from "@get-bb/plugin-sdk/app";
import type { ExperimentalCodeFenceRendererProps } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";

const MAX_STEPS = 4;
const MAX_STEP_LENGTH = 200;

/** Fence body → trimmed suggestions. The body is model output: plain text only. */
function parseSteps(code: string): string[] {
  const steps: string[] = [];
  for (const raw of code.split("\n")) {
    const step = raw
      .trim()
      .replace(/^(?:[-*•]|\d+[.)])\s+/, "")
      .slice(0, MAX_STEP_LENGTH)
      .trim();
    if (step.length > 0 && !steps.includes(step)) steps.push(step);
    if (steps.length === MAX_STEPS) break;
  }
  return steps;
}

function NextSteps({ code, status }: ExperimentalCodeFenceRendererProps) {
  const composer = useComposer();
  const [sending, setSending] = useState(false);
  if (status === "streaming") return null;
  const steps = parseSteps(code);
  if (steps.length === 0) return null;
  const available = composer.scope.kind === "thread";

  async function choose(step: string, event: MouseEvent) {
    if (!composer.isEmpty || event.altKey) {
      composer.insert(step, { at: "end", block: !composer.isEmpty });
      composer.focus();
      return;
    }
    setSending(true);
    try {
      composer.replace({ text: step, mentions: [] });
      await composer.submit();
    } catch {
      // bb shows its own toast when a send fails; leave the text in the draft.
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="my-2 flex flex-wrap gap-2" role="group" aria-label="Suggested next steps"
      title="Click to send · Option-click to edit first"
    >
      {steps.map((step) => (
        <Button
          key={step}
          type="button"
          variant="outline"
          size="sm"
          className="h-auto min-h-8 max-w-full whitespace-normal rounded-full py-1.5 text-left"
          disabled={!available || sending}
          onClick={(event) => void choose(step, event)}
        >
          {step}
        </Button>
      ))}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_codeFenceRenderer({
    id: "next-steps",
    languages: ["next-steps"],
    component: NextSteps,
  });
});
