// bb-plugin-fork-and-agents — backend entry. Everything lives in app.tsx; the
// frontend calls the bb SDK directly, so the server only announces the load.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");
}
