// bb-plugin-handsfree backend. Holds the voice settings and the OpenAI key for
// desktop sessions, and relays GPT-Live's WebRTC offer to OpenAI so the key
// never reaches the page. Phones keep their own settings in the bb voice app.
import { DEFAULT_PREFS, LIVE_VOICES, negotiateWithOpenAI } from "@aj47/bb-voice-core";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const rpcContract = defineRpcContract({
  status: {
    input: z.null(),
    output: z.object({ hasApiKey: z.boolean() }),
  },
  "settings.save": {
    input: z
      .object({
        mode: z.enum(["live", "classic"]).optional(),
        liveVoice: z.string().min(1).max(64).optional(),
        openaiApiKey: z.string().max(400).optional(),
      })
      .strict(),
    output: z.object({ hasApiKey: z.boolean() }),
  },
  "live.negotiate": {
    input: z.object({ offerSdp: z.string().min(1).max(200_000), session: z.record(z.string(), z.unknown()) }).strict(),
    output: z.object({ answerSdp: z.string() }),
  },
});

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    mode: {
      type: "select",
      label: "Voice mode",
      options: ["live", "classic"],
      experimental_optionLabels: { live: "GPT-Live (OpenAI)", classic: "Free (bb transcription + system voice)" },
      default: DEFAULT_PREFS.mode,
    },
    openaiApiKey: { type: "string", label: "OpenAI API key (GPT-Live)", secret: true },
    liveVoice: { type: "select", label: "GPT-Live voice", options: LIVE_VOICES, default: DEFAULT_PREFS.liveVoice },
    liveModel: { type: "string", label: "GPT-Live model", default: DEFAULT_PREFS.liveModel },
    delegateModel: {
      type: "string",
      label: "Tool model (writes agent messages, runs bb tools)",
      default: DEFAULT_PREFS.delegateModel,
    },
  });

  bb.rpc.register(rpcContract, {
    async status() {
      const { openaiApiKey } = await settings.get();
      return { hasApiKey: Boolean(openaiApiKey) };
    },
    async "settings.save"(patch) {
      const next = { ...patch, openaiApiKey: patch.openaiApiKey?.trim() };
      if (!next.openaiApiKey) delete next.openaiApiKey;
      await settings.experimental_set(next);
      const { openaiApiKey } = await settings.get();
      return { hasApiKey: Boolean(openaiApiKey) };
    },
    async "live.negotiate"({ offerSdp, session }) {
      const { openaiApiKey } = await settings.get();
      if (!openaiApiKey) throw new Error("Add an OpenAI API key in the Hands-free voice plugin settings");
      return { answerSdp: await negotiateWithOpenAI(String(openaiApiKey), offerSdp, session) };
    },
  });

  bb.log.info("loaded");
}
