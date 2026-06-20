import { useSettingsStore } from "@/stores/settingsStore";
import { wsClient } from "@/lib/ws";
import { useT } from "@/lib/i18n";
import { Pane } from "./primitives";

export function ProfilePane() {
  const t = useT();
  const profile = useSettingsStore((s) => s.settings?.userProfile ?? "");
  const save = (v: string) => wsClient.send("c2s.settings.update", { partial: { userProfile: v } });
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
