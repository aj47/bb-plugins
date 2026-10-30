// bb-plugin-suggested-next-steps — backend entry.
//
// Asks every agent to end its replies with a ```next-steps fence; app.tsx
// renders that fence as one-click follow-up buttons.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

const INSTRUCTIONS = [
  "When a reply has natural follow-ups, end it with a fenced code block whose language is `next-steps`.",
  "Put one suggestion per line, 2 to 4 lines, each under 80 characters, written as the user's next message in the imperative (\"Run the test suite\", \"Commit these changes\").",
  "No bullets, numbering, or other text inside the block. Make each suggestion specific to what just happened.",
  "bb shows the block as buttons that send the line as the user's next message.",
  "Omit the block when there is no clear follow-up, when you asked the user a question, or in subagent and side-chat replies.",
].join(" ");

export default async function plugin(bb: BbPluginApi) {
  // Settings are read once per load: reload the plugin after changing one.
  const settings = bb.settings.define({
    enabled: {
      type: "boolean",
      label: "Ask agents for suggested next steps",
      default: true,
    },
  });
  const { enabled } = await settings.get();

  // Takes effect when a provider session is next constructed.
  bb.agents.contributeInstructions(() => (enabled ? INSTRUCTIONS : null));

  bb.log.info(`loaded (enabled=${enabled})`);
}
