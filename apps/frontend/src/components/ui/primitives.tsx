import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Search, Check, Eye, EyeOff } from "lucide-react";
import type { Effort, ThinkingMode, AgentRole, ModelCapability } from "@vibeos/shared";
import { usePopoverMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

export const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh"];
export const THINKING_MODES: ThinkingMode[] = ["disabled", "adaptive", "enabled"];
export const ROLES: AgentRole[] = [
  "ui-generation",
  "ui-interaction",
  "system-event",
  "maintenance",
];
export const CAPS: ModelCapability[] = ["text", "vision", "image", "reasoning", "tools"];

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
  return (
    <h2 className="mb-2 ml-1 mt-7 text-[13px] font-medium text-foreground/70 first:mt-0">
      {children}
    </h2>
  );
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

/** A Row's label and hint ids, so the control inside is named by the visible label. */
const RowLabel = createContext<{ label: string; hint?: string } | null>(null);
const useRowLabel = () => useContext(RowLabel);

export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    // In a narrow window the control drops below its label instead of crushing it.
    <div className="flex min-h-[2.5rem] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3.5 py-2">
      <div className="min-w-28 flex-1">
        <div id={id} className="text-[13px]">
          {label}
        </div>
        {hint && (
          <div id={`${id}-hint`} className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">
            {hint}
          </div>
        )}
      </div>
      <div className="max-w-full shrink-0">
        <RowLabel.Provider value={{ label: id, hint: hint ? `${id}-hint` : undefined }}>
          {children}
        </RowLabel.Provider>
      </div>
    </div>
  );
}

/** The native apps' one select: a native control with the OS chevron. */
export function Select({
  value,
  onChange,
  children,
  className,
  ...props
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange" | "className">) {
  const row = useRowLabel();
  return (
    <div className={cn("relative inline-flex", className)}>
      <select
        aria-labelledby={props["aria-label"] ? undefined : row?.label}
        aria-describedby={row?.hint}
        {...props}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="vibe-select h-8 w-full appearance-none truncate rounded-md border bg-background pl-2.5 pr-7 text-[13px] outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
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
  disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  disabled?: boolean;
}) {
  const row = useRowLabel();
  return (
    <div
      role="group"
      aria-labelledby={row?.label}
      className={cn(
        "vibe-segmented inline-flex rounded-lg bg-muted/60 p-0.5 ring-1 ring-border",
        disabled && "opacity-50",
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
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
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  const row = useRowLabel();
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-labelledby={label ? undefined : row?.label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "vibe-switch relative h-[26px] w-[44px] rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-brand" : "bg-muted-foreground/30",
      )}
    >
      <span
        className={cn(
          "vibe-switch-knob absolute top-0.5 size-[22px] rounded-full shadow-sm transition-all",
          // On (brand track) needs an inverting knob so it stays visible in dark
          // mode where --brand is near-white; off (faint track) keeps a white knob.
          checked ? "left-[20px] bg-brand-foreground" : "left-0.5 bg-white",
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
          className="rounded bg-muted px-1.5 py-0.5 text-2xs font-medium text-muted-foreground"
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
  revealLabel,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder: string;
  /** Name of the show-key toggle, e.g. "Show key". */
  revealLabel: string;
}) {
  const [show, setShow] = useState(false);
  const row = useRowLabel();
  return (
    <div className="relative inline-flex w-[16rem] max-w-full">
      <input
        aria-labelledby={row?.label}
        aria-describedby={row?.hint}
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
        aria-label={revealLabel}
        aria-pressed={show}
        title={revealLabel}
        onClick={() => setShow((s) => !s)}
        className="absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
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
  const row = useRowLabel();
  return (
    <input
      aria-labelledby={row?.label}
      aria-describedby={row?.hint}
      key={value}
      defaultValue={value}
      autoComplete="off"
      spellCheck={false}
      onBlur={(e) => {
        if (e.target.value !== value) onSave(e.target.value.trim());
      }}
      placeholder={placeholder}
      className="vibe-input w-[16rem] max-w-full rounded-lg border bg-background py-1.5 px-2.5 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40"
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
  const row = useRowLabel();
  const valueId = useId();
  const close = () => {
    setOpen(false);
    setQ("");
    triggerRef.current?.focus();
  };
  // ↑/↓ move between the search field and the options; Esc closes.
  const onPopoverKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [
      ...(popRef.current?.querySelectorAll<HTMLElement>("input, [data-option]") ?? []),
    ];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next =
      items[Math.min(items.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

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
    <div className="inline-flex w-[15rem] max-w-full">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={row ? `${row.label} ${valueId}` : undefined}
        onClick={() => setOpen((v) => !v)}
        className="vibe-combo flex w-full items-center gap-1.5 rounded-lg border bg-background py-1.5 pl-2.5 pr-2 text-left text-[13px] transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <span id={valueId} className="flex-1 truncate" title={selected?.label ?? value}>
          {selected?.label ?? value}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={popRef}
              {...pop}
              onKeyDown={onPopoverKey}
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
                  // biome-ignore lint/a11y/noAutofocus: opening the picker is an explicit request to search it.
                  autoFocus
                  aria-label={searchPlaceholder}
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
                        <div className="px-2 pb-1 pt-2 text-2xs font-medium text-muted-foreground">
                          {g.name}
                        </div>
                      )}
                      {g.items.map((o) => (
                        <button
                          key={o.value || "_auto"}
                          type="button"
                          data-option
                          aria-current={o.value === value || undefined}
                          onClick={() => {
                            onChange(o.value);
                            close();
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
                            o.value === value
                              ? "bg-accent text-accent-foreground"
                              : "hover:bg-accent/60",
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{o.label}</span>
                            {o.sub && (
                              <span className="block truncate text-2xs text-muted-foreground">
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
