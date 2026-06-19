import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  SlidersHorizontal,
  Server,
  Boxes,
  Info,
  Sun,
  Moon,
  Languages,
  ChevronDown,
  RefreshCw,
  Search,
  Check,
  Eye,
  EyeOff,
  Plus,
  X,
  User,
} from "lucide-react";
import type {
  AgentRole,
  Effort,
  ThinkingMode,
  RoleConfig,
  ProviderId,
  ApiProviderConfig,
  ModelCapability,
  Locale,
  Skin,
} from "@vibeos/shared";
import { AI_PROVIDERS } from "@vibeos/shared";
import { useConnectionStore } from "@/stores/connectionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { wsClient } from "@/lib/ws";
import { useT, useLocale } from "@/lib/i18n";
import { EASE_OUT, usePopoverMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

type CategoryId = "providers" | "models" | "general" | "profile" | "about";

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh"];
const THINKING_MODES: ThinkingMode[] = ["disabled", "adaptive", "enabled"];
const ROLES: AgentRole[] = ["ui-generation", "system-event", "maintenance"];

/**
 * Settings is the one app rendered natively (not AI-hallucinated): it controls
 * real system state. Laid out like macOS System Settings — a category sidebar
 * on the left, a scrollable detail pane on the right.
 */
export function SettingsApp() {
  const t = useT();
  const settings = useSettingsStore((s) => s.settings);
  const [category, setCategory] = useState<CategoryId>("providers");
  if (!settings) return null;

  const CATEGORIES: { id: CategoryId; icon: React.ReactNode; label: string }[] = [
    { id: "providers", icon: <Server className="size-3.5" />, label: t("settings.cat.providers") },
    { id: "models", icon: <Boxes className="size-3.5" />, label: t("settings.cat.models") },
    { id: "general", icon: <SlidersHorizontal className="size-3.5" />, label: t("settings.cat.general") },
    { id: "profile", icon: <User className="size-3.5" />, label: t("settings.cat.profile") },
    { id: "about", icon: <Info className="size-3.5" />, label: t("settings.cat.about") },
  ];

  return (
    <div className="flex h-full bg-background text-foreground">
      <nav className="flex w-52 shrink-0 flex-col gap-0.5 overflow-auto border-r bg-muted/30 px-2.5 py-4">
        {CATEGORIES.map((c) => {
          const active = category === c.id;
          return (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors",
                active ? "bg-accent text-foreground" : "text-foreground/80 hover:bg-accent/50",
              )}
            >
              <span
                className={cn(
                  "flex size-[22px] items-center justify-center rounded-[6px] transition-colors",
                  active ? "bg-brand text-white shadow-sm" : "bg-foreground/[0.06] text-muted-foreground",
                )}
              >
                {c.icon}
              </span>
              {c.label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1 overflow-auto">
        <div className="px-7 py-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={category}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15, ease: EASE_OUT }}
            >
              {category === "providers" && <ProvidersPane />}
              {category === "models" && <DefaultModelsPane />}
              {category === "general" && <GeneralPane />}
              {category === "profile" && <ProfilePane />}
              {category === "about" && <AboutPane />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function GeneralPane() {
  const t = useT();
  const locale = useLocale();
  const theme = useSettingsStore((s) => s.settings?.theme ?? "dark");
  const skin = useSettingsStore((s) => s.settings?.skin ?? "devdock");
  const proactive = useSettingsStore((s) => s.settings?.prefs.proactiveAgents !== false);
  const setLocale = (next: Locale) =>
    wsClient.send("c2s.settings.update", { partial: { locale: next } });
  const setTheme = (next: "light" | "dark") =>
    wsClient.send("c2s.settings.update", { partial: { theme: next } });
  const setSkin = (next: Skin) => wsClient.send("c2s.settings.update", { partial: { skin: next } });
  const setProactive = (on: boolean) =>
    wsClient.send("c2s.settings.update", { partial: { prefs: { proactiveAgents: on } } });

  return (
    <Pane title={t("settings.cat.general")}>
      <GroupLabel>{t("settings.sec.appearance")}</GroupLabel>
      <Group>
        <Row label={t("settings.theme")}>
          <Segmented
            value={theme}
            onChange={setTheme}
            options={[
              { value: "light", label: t("settings.theme.light"), icon: <Sun className="size-3.5" /> },
              { value: "dark", label: t("settings.theme.dark"), icon: <Moon className="size-3.5" /> },
            ]}
          />
        </Row>
        <Row label={t("settings.skin")}>
          <Select value={skin} onChange={(v) => setSkin(v as Skin)}>
            <option value="devdock">{t("settings.skin.default")}</option>
            <option value="xp">Windows XP</option>
            <option value="aqua">Mac Aqua</option>
          </Select>
        </Row>
      </Group>

      <GroupLabel>{t("settings.sec.prefs")}</GroupLabel>
      <Group>
        <Row label={t("settings.language")} hint={t("settings.language.hint")}>
          <Segmented
            value={locale}
            onChange={setLocale}
            options={[
              { value: "zh", label: "中文", icon: <Languages className="size-3.5" /> },
              { value: "en", label: "English", icon: <Languages className="size-3.5" /> },
            ]}
          />
        </Row>
        <Row label={t("settings.proactive")} hint={t("settings.proactive.hint")}>
          <Switch checked={proactive} onChange={setProactive} />
        </Row>
      </Group>
    </Pane>
  );
}

/** Capability chips shown next to a model id. */
function Caps({ caps, t }: { caps?: ModelCapability[]; t: (k: string) => string }) {
  if (!caps?.length) return null;
  return (
    <span className="flex shrink-0 gap-1">
      {caps.map((c) => (
        <span
          key={c}
          className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground"
        >
          {t(`settings.cap.${c}`)}
        </span>
      ))}
    </span>
  );
}

/** Masked credential input that saves on blur. */
function KeyInput({
  value,
  onSave,
  placeholder,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative inline-flex w-[16rem]">
      <input
        key={value}
        type={show ? "text" : "password"}
        defaultValue={value}
        autoComplete="off"
        spellCheck={false}
        onBlur={(e) => {
          if (e.target.value !== value) onSave(e.target.value.trim());
        }}
        placeholder={placeholder}
        className="vibe-input w-full rounded-lg border bg-background py-1.5 pl-2.5 pr-8 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
      >
        {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    </div>
  );
}

function TextInput({
  value,
  onSave,
  placeholder,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      key={value}
      defaultValue={value}
      autoComplete="off"
      spellCheck={false}
      onBlur={(e) => {
        if (e.target.value !== value) onSave(e.target.value.trim());
      }}
      placeholder={placeholder}
      className="vibe-input w-[16rem] rounded-lg border bg-background py-1.5 px-2.5 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40"
    />
  );
}

/** 模型服务 — configure Local Agents (CLI) + API Providers (key/baseURL/models). */
function ProvidersPane() {
  const t = useT();
  const settings = useSettingsStore((s) => s.settings)!;
  const available = useConnectionStore((s) => s.availableProviders);
  const cliProviders = AI_PROVIDERS.filter((p) => p.kind === "cli");
  const apiProviders = AI_PROVIDERS.filter((p) => p.kind === "api");
  const [selected, setSelected] = useState<ProviderId>(apiProviders[0]?.id ?? "openai");
  const [fetching, setFetching] = useState<ProviderId | null>(null);
  const [customModel, setCustomModel] = useState("");

  const cat = AI_PROVIDERS.find((p) => p.id === selected);
  const cfg = settings.apiProviders[selected] ?? {};
  const models = cfg.models ?? cat?.seedModels ?? [];

  // Clear the fetching spinner once models arrive (or after a timeout).
  useEffect(() => {
    if (!fetching) return;
    const tmo = setTimeout(() => setFetching(null), 8000);
    return () => clearTimeout(tmo);
  }, [fetching, settings.apiProviders]);

  const patch = (id: ProviderId, partial: Partial<ApiProviderConfig>) =>
    wsClient.send("c2s.settings.update", { partial: { apiProviders: { [id]: partial } } });

  const addModel = () => {
    const id = customModel.trim();
    if (!id || models.some((m) => m.id === id)) {
      setCustomModel("");
      return;
    }
    const caps: ModelCapability[] = /image|imagen|flux|dall|nano-banana|ideogram|recraft|seedream|qwen-image/i.test(id)
      ? ["image"]
      : ["text", "vision"];
    patch(selected, { models: [...models, { id, name: id, capabilities: caps }] });
    setCustomModel("");
  };
  const removeModel = (id: string) => patch(selected, { models: models.filter((m) => m.id !== id) });

  const ProviderButton = ({ id, label }: { id: ProviderId; label: string }) => {
    const isCli = AI_PROVIDERS.find((p) => p.id === id)?.kind === "cli";
    const on = isCli ? available.includes(id) : settings.apiProviders[id]?.enabled !== false && !!(settings.apiProviders[id]?.apiKey || available.includes(id));
    return (
      <button
        onClick={() => setSelected(id)}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors",
          selected === id ? "bg-accent text-foreground" : "text-foreground/80 hover:bg-accent/50",
        )}
      >
        <span className={cn("size-1.5 shrink-0 rounded-full", on ? "bg-run" : "bg-muted-foreground/30")} />
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
                  {t(available.includes(selected) ? "settings.providers.installed" : "settings.providers.notFound")}
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
                    <RefreshCw className={cn("size-3.5", fetching === selected && "animate-spin")} />
                    {t(fetching === selected ? "settings.providers.fetching" : "settings.providers.fetch")}
                  </button>
                )}
              </div>
              <Group>
                {models.map((m) => (
                  <div key={m.id} className="group/m flex items-center gap-3 px-3.5 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px]">{m.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{m.id}</div>
                    </div>
                    <Caps caps={m.capabilities} t={t} />
                    <button
                      onClick={() => removeModel(m.id)}
                      title={t("settings.providers.remove")}
                      className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/m:opacity-100"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
                {/* Add a custom model id (for models not in the seeded/fetched list). */}
                <div className="flex items-center gap-2 px-2.5 py-2">
                  <input
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addModel()}
                    placeholder={t("settings.providers.addModel")}
                    spellCheck={false}
                    className="vibe-input min-w-0 flex-1 rounded-lg border bg-background py-1.5 px-2.5 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                  <button
                    onClick={addModel}
                    title={t("settings.providers.add")}
                    className="vibe-btn flex shrink-0 items-center gap-1 rounded-lg border bg-card px-2.5 py-1.5 text-[12px] text-foreground/80 transition-colors hover:bg-accent"
                  >
                    <Plus className="size-3.5" />
                    {t("settings.providers.add")}
                  </button>
                </div>
              </Group>
            </>
          )}
        </div>
      </div>
    </Pane>
  );
}

/** 默认模型 — pick provider+model per task, plus the image-generation model. */
function DefaultModelsPane() {
  const t = useT();
  const settings = useSettingsStore((s) => s.settings)!;
  const discovered = useConnectionStore((s) => s.models);
  const available = useConnectionStore((s) => s.availableProviders);

  const usable = (p: (typeof AI_PROVIDERS)[number]) =>
    available.includes(p.id) || !!settings.apiProviders[p.id]?.apiKey || p.id === settings.provider;
  const providerLabel = (id?: string) => AI_PROVIDERS.find((p) => p.id === id)?.label ?? id ?? "";

  // Every usable model across all providers, grouped by provider, for ONE picker.
  // The option value encodes provider+model so a pick implies its provider.
  const buildOptions = (imageOnly: boolean): ComboOption[] => {
    const out: ComboOption[] = [];
    for (const p of AI_PROVIDERS) {
      if (imageOnly ? !p.imageCapable : p.textCapable === false) continue;
      if (!usable(p)) continue;
      let models: { id: string; name: string; image?: boolean }[] = [];
      if (p.kind === "api") {
        models = (settings.apiProviders[p.id]?.models ?? p.seedModels ?? []).map((m) => ({
          id: m.id,
          name: m.name,
          image: m.capabilities?.includes("image"),
        }));
      } else if (p.id === settings.provider) {
        models = discovered.map((m) => ({ id: m.modelId, name: m.name }));
      }
      for (const m of models) {
        if (imageOnly ? !m.image : m.image) continue;
        out.push({ value: `${p.id}::${m.id}`, label: m.name, sub: m.id, group: p.label });
      }
    }
    return out;
  };

  // Build a picker's options, keeping the current selection visible even if its
  // provider/model isn't in the live list.
  const withCurrent = (opts: ComboOption[], provider?: string, model?: string) => {
    const value = provider && model ? `${provider}::${model}` : "";
    const options: ComboOption[] = [{ value: "", label: t("settings.model.auto") }, ...opts];
    if (value && !opts.some((o) => o.value === value)) {
      options.push({ value, label: model!, sub: model, group: providerLabel(provider) });
    }
    return { value, options };
  };

  const parse = (v: string): { provider?: string; model?: string } => {
    if (!v) return { provider: undefined, model: undefined };
    const i = v.indexOf("::");
    return { provider: v.slice(0, i), model: v.slice(i + 2) };
  };

  const patchRole = (role: AgentRole, cfg: Partial<RoleConfig>) =>
    wsClient.send("c2s.settings.update", { partial: { modelOverrides: { [role]: cfg } } });

  const textOptions = buildOptions(false);
  const imageOptions = buildOptions(true);
  const img = settings.prefs.imageModel ?? {};
  const setImage = (partial: { provider?: string; model?: string }) =>
    wsClient.send("c2s.settings.update", { partial: { prefs: { imageModel: { ...img, ...partial } } } });
  const imgPick = withCurrent(imageOptions, img.provider, img.model);

  return (
    <Pane title={t("settings.cat.models")}>
      {ROLES.map((role) => {
        const cfg: RoleConfig = settings.modelOverrides[role] ?? {};
        const pick = withCurrent(textOptions, cfg.provider, cfg.model);
        return (
          <Group key={role} className="mb-2.5">
            <div className="px-3.5 py-2.5">
              <div className="text-[13px] font-medium">{t(`settings.role.${role}.label`)}</div>
            </div>
            <Row label={t("settings.role.model")}>
              <Combobox
                value={pick.value}
                options={pick.options}
                onChange={(v) => patchRole(role, parse(v))}
                searchPlaceholder={t("settings.model.search")}
                emptyLabel={t("settings.model.none")}
              />
            </Row>
            <Row label={t("settings.role.effort")}>
              <Select
                value={cfg.effort ?? ""}
                onChange={(v) => patchRole(role, { effort: (v || undefined) as Effort | undefined })}
              >
                <option value="">{t("settings.effort.default")}</option>
                {EFFORTS.map((ef) => (
                  <option key={ef} value={ef}>{ef}</option>
                ))}
              </Select>
            </Row>
            <Row label={t("settings.role.thinking")}>
              <Select
                value={cfg.thinking ?? ""}
                onChange={(v) => patchRole(role, { thinking: (v || undefined) as ThinkingMode | undefined })}
              >
                <option value="">{t("settings.thinking.default")}</option>
                {THINKING_MODES.map((tm) => (
                  <option key={tm} value={tm}>{t(`settings.thinking.${tm}`)}</option>
                ))}
              </Select>
            </Row>
          </Group>
        );
      })}

      <GroupLabel>{t("settings.models.image")}</GroupLabel>
      <Group>
        <div className="px-3.5 pt-2.5 text-[11px] leading-relaxed text-muted-foreground">
          {t("settings.models.imageHint")}
        </div>
        <Row label={t("settings.role.model")}>
          {imageOptions.length === 0 ? (
            <span className="text-[12px] text-muted-foreground">{t("settings.models.noImageProvider")}</span>
          ) : (
            <Combobox
              value={imgPick.value}
              options={imgPick.options}
              onChange={(v) => setImage(parse(v))}
              searchPlaceholder={t("settings.model.search")}
              emptyLabel={t("settings.model.none")}
            />
          )}
        </Row>
      </Group>
    </Pane>
  );
}

function ProfilePane() {
  const t = useT();
  const profile = useSettingsStore((s) => s.settings?.userProfile ?? "");
  const save = (v: string) =>
    wsClient.send("c2s.settings.update", { partial: { userProfile: v } });
  return (
    <Pane title={t("settings.cat.profile")}>
      <p className="mb-3 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
        {t("settings.profile.hint")}
      </p>
      <textarea
        key={profile}
        defaultValue={profile}
        onBlur={(e) => save(e.target.value)}
        placeholder={t("settings.profile.placeholder")}
        className="min-h-[200px] w-full resize-y rounded-xl border bg-card p-3.5 text-[13px] leading-relaxed outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40"
      />
    </Pane>
  );
}

function AboutPane() {
  const t = useT();
  const bootCount = useConnectionStore((s) => s.bootCount);
  const version = useConnectionStore((s) => s.version);

  return (
    <Pane title={t("settings.cat.about")}>
      <Group>
        <Row label={t("settings.about.system")}>
          <span className="text-[13px] font-medium">{version ? `VibeOS ${version}` : "VibeOS"}</span>
        </Row>
        <Row label={t("settings.about.boots")}>
          <span className="text-[13px] font-medium">{bootCount}</span>
        </Row>
      </Group>
    </Pane>
  );
}

// — macOS-style building blocks ————————————————————————————————————————

function Pane({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {action}
      </div>
      {children}
    </>
  );
}

interface ComboOption {
  value: string;
  label: string;
  /** Sub-label shown under the label (e.g. raw model id). */
  sub?: string;
  /** Group header this option falls under (contiguous options are grouped). */
  group?: string;
}

/** Searchable single-select — used for the model picker (lists can be huge). */
function Combobox({
  value,
  options,
  onChange,
  searchPlaceholder,
  emptyLabel,
}: {
  value: string;
  options: ComboOption[];
  onChange: (v: string) => void;
  searchPlaceholder: string;
  emptyLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [coords, setCoords] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
    maxH: number;
  }>({ left: 0, width: 264, top: 0, maxH: 280 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const pop = usePopoverMotion();

  // Position the portal'd popover near the trigger, flipping above + clamping to
  // the viewport so it never spills off-screen. Recomputes on scroll/resize.
  const place = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = 264;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.min(Math.max(8, r.right - width), vw - width - 8);
    const spaceBelow = vh - r.bottom - 8;
    const spaceAbove = r.top - 8;
    const openUp = spaceBelow < 240 && spaceAbove > spaceBelow;
    const maxH = Math.max(160, Math.min(340, openUp ? spaceAbove : spaceBelow));
    setCoords(
      openUp
        ? { left, width, bottom: vh - r.top + 4, maxH }
        : { left, width, top: r.bottom + 4, maxH },
    );
  };

  useEffect(() => {
    if (!open) return;
    place();
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !popRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const onReflow = () => place();
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(needle) ||
          o.value.toLowerCase().includes(needle) ||
          o.group?.toLowerCase().includes(needle),
      )
    : options;
  // Collapse contiguous same-group options into sections with a header.
  const groups: { name?: string; items: ComboOption[] }[] = [];
  for (const o of filtered) {
    const last = groups[groups.length - 1];
    if (last && last.name === o.group) last.items.push(o);
    else groups.push({ name: o.group, items: [o] });
  }

  return (
    <div className="inline-flex w-[15rem]">
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        className="vibe-combo flex w-full items-center gap-1.5 rounded-lg border bg-background py-1.5 pl-2.5 pr-2 text-left text-[13px] transition-colors hover:bg-accent/40"
      >
        <span className="flex-1 truncate">{selected?.label ?? value}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={popRef}
              {...pop}
              style={{
                position: "fixed",
                left: coords.left,
                width: coords.width,
                top: coords.top,
                bottom: coords.bottom,
                maxHeight: coords.maxH,
              }}
              className="z-[10001] flex flex-col overflow-hidden rounded-lg border bg-popover shadow-xl"
            >
              <div className="flex shrink-0 items-center gap-2 border-b px-2.5">
                <Search className="size-3.5 shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="h-9 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
                />
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-1">
                {filtered.length === 0 ? (
                  <div className="px-2 py-4 text-center text-xs text-muted-foreground">{emptyLabel}</div>
                ) : (
                  groups.map((g, gi) => (
                    <div key={g.name ?? `_g${gi}`}>
                      {g.name && (
                        <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {g.name}
                        </div>
                      )}
                      {g.items.map((o) => (
                        <button
                          key={o.value || "_auto"}
                          onClick={() => {
                            onChange(o.value);
                            setOpen(false);
                            setQ("");
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
                            o.value === value ? "bg-accent" : "hover:bg-accent/60",
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{o.label}</span>
                            {o.sub && <span className="block truncate text-[11px] text-muted-foreground">{o.sub}</span>}
                          </span>
                          {o.value === value && <Check className="size-3.5 shrink-0" />}
                        </button>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 ml-1 mt-7 text-[13px] font-medium text-foreground/70">{children}</h2>;
}

function Group({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn("vibe-group divide-y divide-border overflow-hidden rounded-xl border bg-card", className)}
    >
      {children}
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[2.5rem] items-center justify-between gap-4 px-3.5 py-2">
      <div className="min-w-0">
        <div className="text-[13px]">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Select({
  value,
  onChange,
  children,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative inline-flex", className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="vibe-select w-full appearance-none truncate rounded-lg border bg-background py-1.5 pl-2.5 pr-7 text-[13px] outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: React.ReactNode }[];
}) {
  return (
    <div className="vibe-segmented inline-flex rounded-lg bg-muted/60 p-0.5 ring-1 ring-border">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          data-active={value === o.value ? "true" : undefined}
          className={cn(
            "vibe-seg-btn flex items-center gap-1.5 rounded-[7px] px-2.5 py-1 text-[13px] transition-colors",
            value === o.value
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "vibe-switch relative h-[26px] w-[44px] rounded-full transition-colors",
        checked ? "bg-brand" : "bg-muted-foreground/30",
      )}
    >
      <span
        className={cn(
          "vibe-switch-knob absolute top-0.5 size-[22px] rounded-full bg-white shadow-sm transition-all",
          checked ? "left-[20px]" : "left-0.5",
        )}
      />
    </button>
  );
}
