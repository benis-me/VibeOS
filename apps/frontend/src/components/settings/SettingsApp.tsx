import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { SlidersHorizontal, Server, Boxes, Info, User } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useT } from "@/lib/i18n";
import { EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { GeneralPane } from "./GeneralPane";
import { ProvidersPane } from "./ProvidersPane";
import { DefaultModelsPane } from "./DefaultModelsPane";
import { ProfilePane } from "./ProfilePane";
import { AboutPane } from "./AboutPane";

type CategoryId = "providers" | "models" | "general" | "profile" | "about";

/**
 * Settings is the one app rendered natively (not AI-hallucinated): it controls
 * real system state. Laid out like macOS System Settings — a category sidebar
 * on the left, a scrollable detail pane on the right. Each pane lives in its own
 * file; shared building blocks are in ./primitives.
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
                  active
                    ? "bg-brand text-white shadow-sm"
                    : "bg-foreground/[0.06] text-muted-foreground",
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
