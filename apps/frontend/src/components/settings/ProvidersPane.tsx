import { useEffect, useRef, useState } from "react";
import { RefreshCw, Plus, Pencil, X } from "lucide-react";
import type { ProviderId, ApiProviderConfig, ProviderModel, ModelCapability } from "@vibeos/shared";
import { AI_PROVIDERS, providerModelList } from "@vibeos/shared";
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
  CAPS,
} from "@/components/ui/primitives";

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
  const before = useRef<ProviderModel[] | undefined>(undefined);
  type Draft = { original?: string; id: string; name: string; caps: ModelCapability[] };
  const [draft, setDraft] = useState<Draft | null>(null);

  const cat = AI_PROVIDERS.find((p) => p.id === selected);
  const cfg = settings.apiProviders[selected] ?? {};
  const custom = cfg.models ?? []; // user-added; only these are editable/removable
  // Displayed list = the provider's fetched list (else the catalog) + user custom.
  const models = providerModelList(cat?.seedModels, providerModels[selected], custom);
  const isCustom = (id: string) => custom.some((m) => m.id === id);
  // An API provider is on once it has a key (Settings or env) unless switched off.
  const hasKey = (id: ProviderId) =>
    !!(settings.apiProviders[id]?.apiKey || available.includes(id));
  const isOn = (id: ProviderId) =>
    AI_PROVIDERS.find((p) => p.id === id)?.kind === "cli"
      ? available.includes(id)
      : settings.apiProviders[id]?.enabled !== false && hasKey(id);

  // Safety net to clear the fetching spinner if the result broadcast never
  // arrives (discovery itself gives up after 15s)…
  useEffect(() => {
    if (!fetching) return;
    const tmo = setTimeout(() => setFetching(null), 20000);
    return () => clearTimeout(tmo);
  }, [fetching]);
  // …or the moment this provider's answer lands.
  useEffect(() => {
    if (fetching && providerModels[fetching] !== before.current) setFetching(null);
  }, [providerModels, fetching]);
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
    const on = isOn(id);
    return (
      <button
        type="button"
        aria-current={selected === id || undefined}
        onClick={() => setSelected(id)}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2 py-[7px] text-left text-[13px]",
          selected === id
            ? "bg-accent text-accent-foreground"
            : "text-foreground/80 hover:bg-accent/50",
        )}
      >
        {/* On is a filled dot, off a hollow ring, so the state never rests on color alone. */}
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            on ? "bg-run" : "ring-1 ring-inset ring-muted-foreground/60",
          )}
        />
        <span className="flex-1 truncate">{label}</span>
        <span className="sr-only">
          {t(on ? "settings.providers.on" : "settings.providers.off")}
        </span>
      </button>
    );
  };

  // Model list + add/edit/remove of custom model ids. Shared by Local Agents and
  // API Providers: a CLI like CodeBuddy can't enumerate its account models, so
  // users add the ids by hand here — stored the same way (apiProviders[id].models)
  // and merged into the Default Models picker for every provider kind.
  const modelsManager = (
    <>
      <div className="mb-2 ml-1 mt-7 flex items-center justify-between">
        <h2 className="text-[13px] font-medium text-foreground/70">
          {t("settings.providers.models")} · {models.length}
        </h2>
        {(cat?.kind === "cli" || (cat?.modelsEndpoint && hasKey(selected))) && (
          <button
            onClick={() => {
              before.current = providerModels[selected];
              setFetching(selected);
              wsClient.send("c2s.provider.fetchModels", { providerId: selected });
            }}
            className="vibe-btn flex items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1 text-xs text-foreground/80 hover:bg-accent"
          >
            <RefreshCw className={cn("size-3.5", fetching === selected && "animate-spin")} />
            {t("settings.providers.fetch")}
          </button>
        )}
      </div>
      {models.length > 0 && (
        <Group>
          {models.map((m) => (
            <div key={m.id} className="group/m flex items-center gap-3 px-3.5 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]">{m.name}</div>
                <div className="truncate text-2xs text-muted-foreground">{m.id}</div>
              </div>
              <Caps caps={m.capabilities} t={t} />
              {isCustom(m.id) && (
                <div className="flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity group-hover/m:opacity-100">
                  <button
                    onClick={() => startEdit(m)}
                    title={t("settings.providers.edit")}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    onClick={() => removeModel(m.id)}
                    title={t("settings.providers.remove")}
                    className="text-muted-foreground hover:text-destructive"
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
            {draft.original ? t("settings.providers.edit") : t("settings.providers.addModelBtn")}
          </div>
          <label className="block">
            <span className="mb-1 block text-2xs text-muted-foreground">
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
            <span className="mb-1 block text-2xs text-muted-foreground">
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
            <span className="mb-1.5 block text-2xs text-muted-foreground">
              {t("settings.providers.capabilities")}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {CAPS.map((c) => (
                <button
                  key={c}
                  onClick={() => toggleCap(c)}
                  className={cn(
                    "rounded-md border px-2 py-1 text-2xs",
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
              className="rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent/50"
            >
              {t("settings.providers.cancel")}
            </button>
            <button
              onClick={saveDraft}
              className="vibe-btn rounded-lg border bg-card px-2.5 py-1.5 text-xs text-foreground/80 hover:bg-accent"
            >
              {t("settings.providers.save")}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={startAdd}
          className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground hover:bg-accent/40 hover:text-foreground"
        >
          <Plus className="size-3.5" />
          {t("settings.providers.addModelBtn")}
        </button>
      )}
    </>
  );

  return (
    <Pane title={t("settings.cat.providers")}>
      {/* Narrow panes stack the provider list above its details. */}
      <div className="@container">
        <div className="flex gap-5 @max-xl:flex-col">
          <div className="w-44 shrink-0 space-y-6 @max-xl:w-full">
            <div>
              <GroupLabel>{t("settings.providers.local")}</GroupLabel>
              <div className="@max-xl:grid @max-xl:grid-cols-2">
                {cliProviders.map((p) => (
                  <ProviderButton key={p.id} id={p.id} label={p.label} />
                ))}
              </div>
            </div>
            <div>
              <GroupLabel>{t("settings.providers.api")}</GroupLabel>
              <div className="@max-xl:grid @max-xl:grid-cols-2">
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
                  label={cat?.label}
                  checked={isOn(selected)}
                  disabled={!hasKey(selected)}
                  onChange={(v) => patch(selected, { enabled: v })}
                />
              )}
            </div>

            {cat?.kind === "cli" ? (
              <>
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
                  <div className="px-3.5 py-2.5 text-2xs leading-relaxed text-muted-foreground">
                    {t("settings.providers.cliHint")}
                  </div>
                </Group>

                {available.includes(selected) && modelsManager}
              </>
            ) : (
              <>
                <Group>
                  {cat?.fields?.includes("apiKey") && (
                    <Row label={t("settings.providers.apiKey")}>
                      <KeyInput
                        value={cfg.apiKey ?? ""}
                        onSave={(v) => patch(selected, { apiKey: v || undefined })}
                        placeholder={t("settings.providers.apiKey.placeholder")}
                        revealLabel={t("settings.providers.showKey")}
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

                {modelsManager}
              </>
            )}
          </div>
        </div>
      </div>
    </Pane>
  );
}
