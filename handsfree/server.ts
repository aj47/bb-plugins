// bb-plugin-handsfree backend. The plugin is frontend-only: a thread header
// mic button that hands the thread to the bb voice app's native voice loop.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");
}
