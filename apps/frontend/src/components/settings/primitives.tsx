import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Search, Check, Eye, EyeOff } from "lucide-react";
import type {
  Effort,
  ThinkingMode,
  AgentRole,
  ModelCapability,
  ProviderModel,
} from "@vibeos/shared";
import { usePopoverMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

export const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh"];
export const THINKING_MODES: ThinkingMode[] = ["disabled", "adaptive", "enabled"];
export const ROLES: AgentRole[] = ["ui-generation", "system-event", "maintenance"];
export const CAPS: ModelCapability[] = ["text", "vision", "image", "reasoning", "tools"];

/** Merge model lists (seed + discovered + custom); later entries win by id. */
export function mergeModels(...lists: (ProviderModel[] | undefined)[]): ProviderModel[] {
  const map = new Map<string, ProviderModel>();
  for (const list of lists) for (const m of list ?? []) map.set(m.id, m);
  return [...map.values()];
}

// — macOS-style building blocks ————————————————————————————————————————

export function Pane({
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

export function GroupLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 ml-1 mt-7 text-[13px] font-medium text-foreground/70">{children}</h2>;
}

export function Group({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "vibe-group divide-y divide-border overflow-hidden rounded-xl border bg-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Row({
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
        {hint && (
          <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{hint}</div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function Select({
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

export function Segmented<T extends string>({
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

export function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
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

/** Capability chips shown next to a model id. */
export function Caps({ caps, t }: { caps?: ModelCapability[]; t: (k: string) => string }) {
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
export function KeyInput({
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

export function TextInput({
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

export interface ComboOption {
  value: string;
  label: string;
  /** Sub-label shown under the label (e.g. raw model id). */
  sub?: string;
  /** Group header this option falls under (contiguous options are grouped). */
  group?: string;
}

/** Searchable single-select — used for the model picker (lists can be huge). */
export function Combobox({
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
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="h-9 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
                />
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-1">
                {filtered.length === 0 ? (
                  <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                    {emptyLabel}
                  </div>
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
                            {o.sub && (
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {o.sub}
                              </span>
                            )}
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
