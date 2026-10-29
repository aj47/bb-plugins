// Settings → Favorite models: pick models with bb's own provider/model picker,
// give them optional nicknames, and order them. The first is "my favorite".
import {
  definePluginApp,
  experimental_ProviderModelPicker as ProviderModelPicker,
  useRealtime,
  useRpc,
  type ExperimentalProviderModelPickerValue,
} from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState } from "react";
import type { Favorite, rpcContract } from "./server";

const FAVORITES_CHANNEL = "favorites"; // server.ts publishes on it after each save

type CatalogEntry = { providerName: string; displayName: string; isDefault: boolean };

// Display names from the same catalog bb's pickers use, keyed "providerId:model".
async function loadCatalog(): Promise<Map<string, CatalogEntry>> {
  type Options = {
    providers: { id: string; displayName: string; available: boolean }[];
    models: { model: string; displayName?: string | null; isDefault?: boolean }[];
  };
  const get = async (q: string) => (await fetch(`/api/v1/system/execution-options${q}`)).json() as Promise<Options>;
  const { providers } = await get("");
  const out = new Map<string, CatalogEntry>();
  const lists = await Promise.allSettled(
    providers.filter((p) => p.available).map(async (p) => ({ p, models: (await get(`?providerId=${encodeURIComponent(p.id)}`)).models })),
  );
  for (const r of lists) {
    if (r.status !== "fulfilled") continue;
    for (const m of r.value.models) {
      out.set(`${r.value.p.id}:${m.model}`, { providerName: r.value.p.displayName, displayName: m.displayName || m.model, isDefault: Boolean(m.isDefault) });
    }
  }
  return out;
}

const key = (f: { providerId: string; model: string }) => `${f.providerId}:${f.model}`;

function FavoriteModels() {
  const rpc = useRpc<typeof rpcContract>();
  const [favorites, setFavorites] = useState<Favorite[] | null>(null);
  const [catalog, setCatalog] = useState<Map<string, CatalogEntry>>(new Map());
  const [pick, setPick] = useState<ExperimentalProviderModelPickerValue | null>(null);
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    rpc.call("favorites.list", {}).then((r) => setFavorites(r.favorites), (e) => setError(String(e?.message ?? e)));
  }, [rpc]);

  useEffect(() => {
    load();
    loadCatalog().then((c) => {
      setCatalog(c);
      // Seed the picker with the first provider's default model.
      const first = [...c.entries()].find(([, m]) => m.isDefault) ?? [...c.entries()][0];
      if (first) {
        const i = first[0].indexOf(":");
        setPick((p) => p ?? { providerId: first[0].slice(0, i), model: first[0].slice(i + 1), reasoningLevel: "medium" as ExperimentalProviderModelPickerValue["reasoningLevel"] });
      }
    }, () => {});
  }, [load]);

  useRealtime(FAVORITES_CHANNEL, load);

  const save = async (next: Favorite[]) => {
    setError(null);
    try {
      setFavorites((await rpc.call("favorites.save", { favorites: next })).favorites);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const label = (f: Favorite) => {
    const c = catalog.get(key(f));
    return c ? `${c.displayName} · ${c.providerName}` : `${f.model} · ${f.providerId}`;
  };

  const list = favorites ?? [];
  const move = (i: number, by: number) => {
    const next = [...list];
    const [f] = next.splice(i, 1);
    next.splice(i + by, 0, f);
    void save(next);
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">
        Say a nickname or model name to the voice ("start a thread with my fast model", "use my favorite"). The first one is your favorite.
      </p>
      {favorites === null ? <p className="text-muted-foreground">Loading…</p> : null}
      {favorites && list.length === 0 ? <p className="text-muted-foreground">No favorites yet.</p> : null}
      <ul className="flex flex-col gap-1">
        {list.map((f, i) => (
          <li key={key(f)} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
            <span className="w-5 text-muted-foreground">{i === 0 ? "★" : i + 1}</span>
            <span className="min-w-0 flex-1 truncate">{label(f)}</span>
            <input
              className="w-36 rounded-md border border-border bg-transparent px-2 py-1"
              placeholder="nickname"
              defaultValue={f.nickname ?? ""}
              aria-label={`Nickname for ${label(f)}`}
              onBlur={(e) => {
                const nick = e.target.value.trim();
                if (nick !== (f.nickname ?? "")) void save(list.map((x, j) => (j === i ? { ...x, nickname: nick || undefined } : x)));
              }}
            />
            <button type="button" className="px-1 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
              ↑
            </button>
            <button type="button" className="px-1 disabled:opacity-30" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
              ↓
            </button>
            <button type="button" className="px-1" onClick={() => void save(list.filter((_, j) => j !== i))} aria-label={`Remove ${label(f)}`}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        {pick ? <ProviderModelPicker value={pick} onChange={setPick} /> : <span className="text-muted-foreground">Loading models…</span>}
        <input
          className="w-36 rounded-md border border-border bg-transparent px-2 py-1"
          placeholder="nickname (optional)"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1 font-medium disabled:opacity-50"
          disabled={!pick || list.some((f) => pick && key(f) === key(pick))}
          onClick={() => {
            if (!pick) return;
            void save([...list, { providerId: pick.providerId, model: pick.model, ...(nickname.trim() ? { nickname: nickname.trim() } : {}) }]);
            setNickname("");
          }}
        >
          Add favorite
        </button>
      </div>
      {error ? <p className="text-red-500">{error}</p> : null}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "favorite-models",
    title: "Favorite models",
    description: "Models you start threads on most, with nicknames the voice understands.",
    component: FavoriteModels,
  });
});
