import { useState } from "react";
import { SlidersHorizontal, Server, Boxes, Info, User, Brain } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { GeneralPane } from "./GeneralPane";
import { ProvidersPane } from "./ProvidersPane";
import { DefaultModelsPane } from "./DefaultModelsPane";
import { ProfilePane } from "./ProfilePane";
import { MemoryPane } from "./MemoryPane";
import { AboutPane } from "./AboutPane";

type CategoryId = "providers" | "models" | "general" | "profile" | "memory" | "about";

/**
 * Settings is the one app rendered natively (not AI-hallucinated): it controls
 * real system state. Laid out like macOS System Settings — a category sidebar
 * on the left, a scrollable detail pane on the right. Each pane lives in its own
 * file; shared building blocks are in @/components/ui/primitives.
 */
export function SettingsApp() {
  const t = useT();
  const settings = useSettingsStore((s) => s.settings);
  const [category, setCategory] = useState<CategoryId>("providers");
  if (!settings) return null;

  const CATEGORIES: { id: CategoryId; icon: React.ReactNode; label: string }[] = [
    { id: "providers", icon: <Server className="size-3.5" />, label: t("settings.cat.providers") },
    { id: "models", icon: <Boxes className="size-3.5" />, label: t("settings.cat.models") },
    {
      id: "general",
      icon: <SlidersHorizontal className="size-3.5" />,
      label: t("settings.cat.general"),
    },
    { id: "profile", icon: <User className="size-3.5" />, label: t("settings.cat.profile") },
    { id: "memory", icon: <Brain className="size-3.5" />, label: t("memory.title") },
    { id: "about", icon: <Info className="size-3.5" />, label: t("settings.cat.about") },
  ];

  // A narrow window keeps only the category icons, so the pane keeps its room.
  return (
    <div className="@container flex h-full bg-background text-foreground">
      <nav
        aria-label={t("settings.title")}
        // Items touch (no gap) so the pointer never crosses a dead strip between
        // them; the 1px of extra padding keeps the old rhythm.
        className="flex w-52 shrink-0 flex-col overflow-auto border-r bg-muted/30 px-2.5 py-4 @max-2xl:w-14 @max-2xl:px-2"
      >
        {CATEGORIES.map((c) => {
          const active = category === c.id;
          return (
            <button
              key={c.id}
              type="button"
              aria-current={active ? "page" : undefined}
              title={c.label}
              onClick={() => setCategory(c.id)}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2 py-[7px] text-left text-[13px] @max-2xl:justify-center @max-2xl:px-0",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground/80 hover:bg-accent/50",
              )}
            >
              <span
                className={cn(
                  "flex size-[22px] items-center justify-center rounded-[6px] transition-colors",
                  active
                    ? "bg-brand text-brand-foreground shadow-sm"
                    : "bg-foreground/[0.06] text-muted-foreground",
                )}
              >
                {c.icon}
              </span>
              <span className="truncate @max-2xl:sr-only">{c.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Switching categories is frequent, so the pane swaps instantly. */}
      <div className="min-w-0 flex-1 overflow-auto">
        <div className="px-7 py-6 @max-2xl:px-4 @max-2xl:py-4">
          {category === "providers" && <ProvidersPane />}
          {category === "models" && <DefaultModelsPane />}
          {category === "general" && <GeneralPane />}
          {category === "profile" && <ProfilePane />}
          {category === "memory" && <MemoryPane />}
          {category === "about" && <AboutPane />}
        </div>
      </div>
    </div>
  );
}
