import { useEffect, useState } from "react";
import { RefreshCw, Plus, Pencil, X } from "lucide-react";
import type { ProviderId, ApiProviderConfig, ProviderModel, ModelCapability } from "@vibeos/shared";
import { AI_PROVIDERS } from "@vibeos/shared";
import { useConnectionStore } from "@/stores/connectionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { wsClient } from "@/lib/ws";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  Pane,
  GroupLabel,
  Group,
  Row,
  Switch,
  KeyInput,
  TextInput,
  Caps,
  mergeModels,
  CAPS,
} from "./primitives";

/** 模型服务 — configure Local Agents (CLI) + API Providers (key/baseURL/models). */
export function ProvidersPane() {
  const t = useT();
  const settings = useSettingsStore((s) => s.settings)!;
  const available = useConnectionStore((s) => s.availableProviders);
  const providerModels = useConnectionStore((s) => s.providerModels);
  const cliProviders = AI_PROVIDERS.filter((p) => p.kind === "cli");
  const apiProviders = AI_PROVIDERS.filter((p) => p.kind === "api");
  const [selected, setSelected] = useState<ProviderId>(apiProviders[0]?.id ?? "openai");
  const [fetching, setFetching] = useState<ProviderId | null>(null);
  type Draft = { original?: string; id: string; name: string; caps: ModelCapability[] };
  const [draft, setDraft] = useState<Draft | null>(null);

  const cat = AI_PROVIDERS.find((p) => p.id === selected);
  const cfg = settings.apiProviders[selected] ?? {};
  const custom = cfg.models ?? []; // user-added; only these are editable/removable
  // Displayed list = catalog seed + live-discovered + user custom (deduped).
  const models = mergeModels(cat?.seedModels, providerModels[selected], custom);
  const isCustom = (id: string) => custom.some((m) => m.id === id);

  // Clear the fetching spinner once models arrive (or after a timeout).
  useEffect(() => {
    if (!fetching) return;
    const tmo = setTimeout(() => setFetching(null), 8000);
    return () => clearTimeout(tmo);
  }, [fetching, settings.apiProviders]);
  // Drop any in-progress model edit when switching providers.
  useEffect(() => setDraft(null), [selected]);

  const patch = (id: ProviderId, partial: Partial<ApiProviderConfig>) =>
    wsClient.send("c2s.settings.update", { partial: { apiProviders: { [id]: partial } } });

  const startAdd = () => setDraft({ id: "", name: "", caps: ["text", "vision"] });
  const startEdit = (m: ProviderModel) =>
    setDraft({ original: m.id, id: m.id, name: m.name, caps: [...(m.capabilities ?? [])] });
  const toggleCap = (c: ModelCapability) =>
    setDraft((d) =>
      d ? { ...d, caps: d.caps.includes(c) ? d.caps.filter((x) => x !== c) : [...d.caps, c] } : d,
    );
  const saveDraft = () => {
    if (!draft) return;
    const id = draft.id.trim();
    if (!id) return;
    const entry: ProviderModel = { id, name: draft.name.trim() || id, capabilities: draft.caps };
    const key = draft.original ?? id;
    const next = custom.some((m) => m.id === key)
      ? custom.map((m) => (m.id === key ? entry : m))
      : [...custom, entry];
    patch(selected, { models: next });
    setDraft(null);
  };
  const removeModel = (id: string) =>
    patch(selected, { models: custom.filter((m) => m.id !== id) });

  const ProviderButton = ({ id, label }: { id: ProviderId; label: string }) => {
    const isCli = AI_PROVIDERS.find((p) => p.id === id)?.kind === "cli";
    const on = isCli
      ? available.includes(id)
      : settings.apiProviders[id]?.enabled !== false &&
        !!(settings.apiProviders[id]?.apiKey || available.includes(id));
    return (
      <button
        onClick={() => setSelected(id)}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors",
          selected === id ? "bg-accent text-foreground" : "text-foreground/80 hover:bg-accent/50",
        )}
      >
        <span
          className={cn("size-1.5 shrink-0 rounded-full", on ? "bg-run" : "bg-muted-foreground/30")}
        />
        <span className="flex-1 truncate">{label}</span>
      </button>
    );
  };

  return (
    <Pane title={t("settings.cat.providers")}>
      <div className="flex gap-5">
        <div className="w-44 shrink-0 space-y-4">
          <div>
            <GroupLabel>{t("settings.providers.local")}</GroupLabel>
            <div className="space-y-0.5">
              {cliProviders.map((p) => (
                <ProviderButton key={p.id} id={p.id} label={p.label} />
              ))}
            </div>
          </div>
          <div>
            <GroupLabel>{t("settings.providers.api")}</GroupLabel>
            <div className="space-y-0.5">
              {apiProviders.map((p) => (
                <ProviderButton key={p.id} id={p.id} label={p.label} />
              ))}
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-[15px] font-semibold">{cat?.label}</h2>
            {cat?.kind === "api" && (
              <Switch
                checked={cfg.enabled !== false}
                onChange={(v) => patch(selected, { enabled: v })}
              />
            )}
          </div>

          {cat?.kind === "cli" ? (
            <Group>
              <Row label={t("settings.providers.status")}>
                <span className="flex items-center gap-1.5 text-[13px]">
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      available.includes(selected) ? "bg-run" : "bg-muted-foreground/40",
                    )}
                  />
                  {t(
                    available.includes(selected)
                      ? "settings.providers.installed"
                      : "settings.providers.notFound",
                  )}
                </span>
              </Row>
              <div className="px-3.5 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                {t("settings.providers.cliHint")}
              </div>
            </Group>
          ) : (
            <>
              <Group>
                {cat?.fields?.includes("apiKey") && (
                  <Row label={t("settings.providers.apiKey")}>
                    <KeyInput
                      value={cfg.apiKey ?? ""}
                      onSave={(v) => patch(selected, { apiKey: v || undefined })}
                      placeholder={t("settings.providers.apiKey.placeholder")}
                    />
                  </Row>
                )}
                {cat?.fields?.includes("baseUrl") && (
                  <Row label={t("settings.providers.baseUrl")}>
                    <TextInput
                      value={cfg.baseUrl ?? ""}
                      onSave={(v) => patch(selected, { baseUrl: v || undefined })}
                      placeholder={cat?.defaultBaseUrl ?? ""}
                    />
                  </Row>
                )}
              </Group>

              <div className="mb-2 ml-1 mt-7 flex items-center justify-between">
                <h2 className="text-[13px] font-medium text-foreground/70">
                  {t("settings.providers.models")} · {models.length}
                </h2>
                {cat?.modelsEndpoint && (
                  <button
                    onClick={() => {
                      setFetching(selected);
                      wsClient.send("c2s.provider.fetchModels", { providerId: selected });
                    }}
                    className="vibe-btn flex items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1 text-[12px] text-foreground/80 transition-colors hover:bg-accent"
                  >
                    <RefreshCw
                      className={cn("size-3.5", fetching === selected && "animate-spin")}
                    />
                    {t(
                      fetching === selected
                        ? "settings.providers.fetching"
                        : "settings.providers.fetch",
                    )}
                  </button>
                )}
              </div>
              {models.length > 0 && (
                <Group>
                  {models.map((m) => (
                    <div key={m.id} className="group/m flex items-center gap-3 px-3.5 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px]">{m.name}</div>
                        <div className="truncate text-[11px] text-muted-foreground">{m.id}</div>
                      </div>
                      <Caps caps={m.capabilities} t={t} />
                      {isCustom(m.id) && (
                        <div className="flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity group-hover/m:opacity-100">
                          <button
                            onClick={() => startEdit(m)}
                            title={t("settings.providers.edit")}
                            className="text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            onClick={() => removeModel(m.id)}
                            title={t("settings.providers.remove")}
                            className="text-muted-foreground transition-colors hover:text-destructive"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </Group>
              )}

              {draft ? (
                <div className="mt-2.5 space-y-2.5 rounded-xl border bg-card p-3.5">
                  <div className="text-[13px] font-medium">
                    {draft.original
                      ? t("settings.providers.edit")
                      : t("settings.providers.addModelBtn")}
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-muted-foreground">
                      {t("settings.providers.modelName")}
                    </span>
                    <input
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      placeholder={t("settings.providers.modelName")}
                      className="vibe-input w-full rounded-lg border bg-background px-2.5 py-1.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-muted-foreground">
                      {t("settings.providers.modelId")}
                    </span>
                    <input
                      value={draft.id}
                      onChange={(e) => setDraft({ ...draft, id: e.target.value })}
                      placeholder={t("settings.providers.modelId")}
                      spellCheck={false}
                      className="vibe-input w-full rounded-lg border bg-background px-2.5 py-1.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    />
                  </label>
                  <div>
                    <span className="mb-1.5 block text-[11px] text-muted-foreground">
                      {t("settings.providers.capabilities")}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {CAPS.map((c) => (
                        <button
                          key={c}
                          onClick={() => toggleCap(c)}
                          className={cn(
                            "rounded-md border px-2 py-1 text-[11px] transition-colors",
                            draft.caps.includes(c)
                              ? "border-brand bg-brand/10 text-foreground"
                              : "text-muted-foreground hover:bg-accent/50",
                          )}
                        >
                          {t(`settings.cap.${c}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      onClick={() => setDraft(null)}
                      className="rounded-lg px-2.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent/50"
                    >
                      {t("settings.providers.cancel")}
                    </button>
                    <button
                      onClick={saveDraft}
                      className="vibe-btn rounded-lg border bg-card px-2.5 py-1.5 text-[12px] text-foreground/80 transition-colors hover:bg-accent"
                    >
                      {t("settings.providers.save")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={startAdd}
                  className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-[12px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
                >
                  <Plus className="size-3.5" />
                  {t("settings.providers.addModelBtn")}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </Pane>
  );
}
