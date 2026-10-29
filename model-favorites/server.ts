// bb-plugin-model-favorites backend: an ordered list of favorite agent models
// ({ providerId, model, nickname? }) in plugin storage. Other clients read it
// over RPC — the bb voice app calls /api/v1/plugins/model-favorites/rpc/favorites.list
// so you can say "start a thread with my fast model".
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const FAVORITES_LIMIT = 20;
const KEY = "favorites";
export const FAVORITES_CHANNEL = "favorites";

const favorite = z
  .object({
    providerId: z.string().min(1).max(120),
    model: z.string().min(1).max(300),
    nickname: z.string().trim().max(60).optional(),
  })
  .strict();

export type Favorite = z.infer<typeof favorite>;

export const rpcContract = defineRpcContract({
  "favorites.list": {
    input: z.object({}).strict(),
    output: z.object({ favorites: z.array(favorite) }),
  },
  // Replaces the whole list; its order is the order of preference.
  "favorites.save": {
    input: z.object({ favorites: z.array(favorite).max(FAVORITES_LIMIT) }).strict(),
    output: z.object({ favorites: z.array(favorite) }),
  },
});

export default async function plugin(bb: BbPluginApi) {
  const read = async () => (await bb.storage.kv.get<Favorite[]>(KEY)) ?? [];

  bb.rpc.register(
    rpcContract,
    {
      async "favorites.list"() {
        return { favorites: await read() };
      },
      async "favorites.save"({ favorites }) {
        // One entry per provider/model; a blank nickname is no nickname.
        const seen = new Set<string>();
        const next = favorites
          .map((f) => (f.nickname ? f : { providerId: f.providerId, model: f.model }))
          .filter((f) => {
            const id = `${f.providerId}:${f.model}`;
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
          });
        await bb.storage.kv.set(KEY, next);
        bb.realtime.publish(FAVORITES_CHANNEL, null);
        return { favorites: next };
      },
    },
    { experimental_discoverable: true, experimental_description: "Favorite agent models for starting threads" },
  );

  bb.log.info("loaded");
}
