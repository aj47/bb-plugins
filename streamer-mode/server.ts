// bb-plugin-streamer-mode — headless backend. All masking happens in app.tsx.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");
}
