import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  SlidersHorizontal,
  Cpu,
  Info,
  Sun,
  Moon,
  Languages,
  ChevronDown,
  RefreshCw,
  Search,
  Check,
  User,
} from "lucide-react";
import type { AgentRole, Effort, ThinkingMode, RoleConfig, ProviderId, Locale, Skin } from "@vibeos/shared";
import { AI_PROVIDERS } from "@vibeos/shared";
import { useConnectionStore } from "@/stores/connectionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { wsClient } from "@/lib/ws";
import { useT, useLocale } from "@/lib/i18n";
import { EASE_OUT, usePopoverMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

type CategoryId = "general" | "ai" | "profile" | "about";

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
  const [category, setCategory] = useState<CategoryId>("general");
  if (!settings) return null;

  const CATEGORIES: { id: CategoryId; icon: React.ReactNode; label: string }[] = [
    { id: "general", icon: <SlidersHorizontal className="size-3.5" />, label: t("settings.cat.general") },
    { id: "ai", icon: <Cpu className="size-3.5" />, label: t("settings.cat.ai") },
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
        <div className="mx-auto max-w-[34rem] px-7 py-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={category}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15, ease: EASE_OUT }}
            >
              {category === "general" && <GeneralPane />}
              {category === "ai" && <AiEnginePane />}
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

function AiEnginePane() {
  const t = useT();
  const settings = useSettingsStore((s) => s.settings);
  const models = useConnectionStore((s) => s.models);
  const available = useConnectionStore((s) => s.availableProviders);
  const [scanning, setScanning] = useState(false);

  // Clear the scanning state once fresh availability/models arrive (or time out).
  useEffect(() => {
    if (!scanning) return;
    const tmo = setTimeout(() => setScanning(false), 10_000);
    return () => clearTimeout(tmo);
  }, [scanning, models, available]);

  if (!settings) return null;

  const provider = settings.provider;
  // Show only providers usable on this host, but never drop the active one.
  const providerOptions = AI_PROVIDERS.filter(
    (p) => available.includes(p.id) || p.id === provider,
  );
  const setProvider = (id: ProviderId) =>
    wsClient.send("c2s.settings.update", { partial: { provider: id } });
  const patchRole = (role: AgentRole, cfg: Partial<RoleConfig>) =>
    wsClient.send("c2s.settings.update", { partial: { modelOverrides: { [role]: cfg } } });
  const scan = () => {
    setScanning(true);
    wsClient.send("c2s.provider.scan", {});
  };

  const baseModelOptions = [
    { value: "", label: t("settings.model.auto") },
    ...models.map((m) => ({ value: m.modelId, label: m.name })),
  ];

  return (
    <Pane
      title={t("settings.cat.ai")}
      action={
        <button
          onClick={scan}
          title={t("settings.scan.hint")}
          className="vibe-btn flex items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-[12px] text-foreground/80 transition-colors hover:bg-accent"
        >
          <RefreshCw className={cn("size-3.5", scanning && "animate-spin")} />
          {t(scanning ? "settings.scanning" : "settings.scan")}
        </button>
      }
    >
      <Group>
        <Row label={t("settings.provider")}>
          <Select value={provider} onChange={(v) => setProvider(v as ProviderId)}>
            {providerOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Row>
      </Group>

      <GroupLabel>{t("settings.models")}</GroupLabel>
      {ROLES.map((role) => {
        const cfg: RoleConfig = settings.modelOverrides[role] ?? {};
        // Keep a stored model id selectable even if it isn't in the current list.
        const modelOptions =
          cfg.model && !models.some((m) => m.modelId === cfg.model)
            ? [...baseModelOptions, { value: cfg.model, label: cfg.model }]
            : baseModelOptions;
        return (
          <Group key={role} className="mb-2.5">
            <div className="px-3.5 py-2.5">
              <div className="text-[13px] font-medium">{t(`settings.role.${role}.label`)}</div>
            </div>
            <Row label={t("settings.role.model")}>
              <Combobox
                value={cfg.model ?? ""}
                options={modelOptions}
                onChange={(v) => patchRole(role, { model: v || undefined })}
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
                  <option key={ef} value={ef}>
                    {ef}
                  </option>
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
                  <option key={tm} value={tm}>
                    {t(`settings.thinking.${tm}`)}
                  </option>
                ))}
              </Select>
            </Row>
          </Group>
        );
      })}
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
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 256 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const pop = usePopoverMotion();

  // Position the portal'd popover under the trigger (right-aligned). Recompute
  // on scroll/resize so it tracks the trigger as the settings pane scrolls.
  const place = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = 256;
    setCoords({ top: r.bottom + 4, left: Math.max(8, r.right - width), width });
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
        (o) => o.label.toLowerCase().includes(needle) || o.value.toLowerCase().includes(needle),
      )
    : options;

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
              style={{ position: "fixed", top: coords.top, left: coords.left, width: coords.width }}
              className="z-[10001] origin-top-right overflow-hidden rounded-lg border bg-popover shadow-xl"
            >
              <div className="flex items-center gap-2 border-b px-2.5">
                <Search className="size-3.5 shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="h-9 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
                />
              </div>
              <div className="max-h-60 overflow-auto p-1">
                {filtered.length === 0 ? (
                  <div className="px-2 py-4 text-center text-xs text-muted-foreground">{emptyLabel}</div>
                ) : (
                  filtered.map((o) => (
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
                      <span className="flex-1 truncate">{o.label}</span>
                      {o.value === value && <Check className="size-3.5 shrink-0" />}
                    </button>
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
