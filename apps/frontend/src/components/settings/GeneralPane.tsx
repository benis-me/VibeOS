import { useEffect, useRef, useState } from "react";
import { Sun, Moon, Languages, Upload, Sparkles, Loader2 } from "lucide-react";
import type { Locale, Skin } from "@vibeos/shared";
import { useSettingsStore } from "@/stores/settingsStore";
import { wsClient, API_BASE } from "@/lib/ws";
import { fileToWallpaperDataUrl } from "@/lib/image";
import { useT, useLocale } from "@/lib/i18n";
import { Pane, GroupLabel, Group, Row, Select, Segmented, Switch } from "./primitives";

export function GeneralPane() {
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
              {
                value: "light",
                label: t("settings.theme.light"),
                icon: <Sun className="size-3.5" />,
              },
              {
                value: "dark",
                label: t("settings.theme.dark"),
                icon: <Moon className="size-3.5" />,
              },
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
        <WallpaperRow />
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

/** Desktop wallpaper: upload an image, or generate one (needs an image model). */
function WallpaperRow() {
  const t = useT();
  const wallpaper = useSettingsStore((s) => s.settings?.prefs.wallpaper);
  const imageModel = useSettingsStore((s) => s.settings?.prefs.imageModel);
  const imageOn = !!(imageModel?.provider && imageModel?.model);
  const fileRef = useRef<HTMLInputElement>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<null | "upload" | "generate">(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  // Hold the spinner until the wallpaper image is actually READY. Generation
  // persists the /api/img path at once (settings.changed lands immediately), but
  // the bytes aren't produced until the route is first awaited — so wait for the
  // new image to load rather than clearing the instant the path changes.
  useEffect(
    () =>
      wsClient.on("s2c.settings.changed", ({ settings }) => {
        if (!busyRef.current) return;
        const wp = settings.prefs.wallpaper;
        if (!wp) return setBusy(null);
        const img = new Image();
        const done = () => setBusy(null);
        img.onload = done;
        img.onerror = done;
        img.src = `${API_BASE}${wp}`;
      }),
    [],
  );
  // A server error (generation failed / no model) releases the spinner, and a
  // hard backstop guarantees it can never get stuck if no signal ever arrives.
  useEffect(() => wsClient.on("s2c.error", () => setBusy(null)), []);
  useEffect(() => {
    if (!busy) return;
    const tmo = setTimeout(() => setBusy(null), 120_000);
    return () => clearTimeout(tmo);
  }, [busy]);

  const wallpaperUrl = wallpaper ? `${API_BASE}${wallpaper}` : null;

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setBusy("upload");
    try {
      wsClient.send("c2s.wallpaper.upload", { dataUrl: await fileToWallpaperDataUrl(file) });
    } catch {
      setBusy(null);
    }
  };

  const onGenerate = () => {
    const p = prompt.trim();
    if (!p || !imageOn || busy) return;
    setBusy("generate");
    wsClient.send("c2s.wallpaper.generate", { prompt: p });
  };

  const onReset = () =>
    wsClient.send("c2s.settings.update", { partial: { prefs: { wallpaper: "" } } });

  return (
    <div className="px-3.5 py-3">
      <div className="flex items-start gap-3.5">
        <div
          className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg border bg-cover bg-center"
          style={
            wallpaperUrl
              ? { backgroundImage: `url("${wallpaperUrl}")` }
              : {
                  background:
                    "radial-gradient(120% 120% at 80% 0%, color-mix(in oklab, var(--brand) 32%, var(--muted)), var(--muted) 70%)",
                }
          }
        >
          {busy && (
            <div className="absolute inset-0 grid place-items-center bg-black/35">
              <Loader2 className="size-4 animate-spin text-white" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-[13px]">{t("settings.wallpaper")}</div>
          <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {t("settings.wallpaper.hint")}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={!!busy}
              className="vibe-btn flex items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-[12px] text-foreground/80 transition-colors hover:bg-accent disabled:opacity-50"
            >
              <Upload className="size-3.5" />
              {t("settings.wallpaper.upload")}
            </button>
            {wallpaper && (
              <button
                type="button"
                onClick={onReset}
                disabled={!!busy}
                className="vibe-btn rounded-lg border bg-card px-2.5 py-1.5 text-[12px] text-foreground/80 transition-colors hover:bg-accent disabled:opacity-50"
              >
                {t("settings.wallpaper.reset")}
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onPick}
            />
          </div>

          <div className="mt-2 flex items-center gap-2">
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onGenerate()}
              disabled={!imageOn || !!busy}
              placeholder={t("settings.wallpaper.promptPlaceholder")}
              className="vibe-input min-w-0 flex-1 rounded-lg border bg-background px-2.5 py-1.5 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={onGenerate}
              disabled={!imageOn || !prompt.trim() || !!busy}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-medium text-brand-foreground transition-colors hover:bg-brand/90 disabled:opacity-50"
            >
              {busy === "generate" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              {t(busy === "generate" ? "settings.wallpaper.generating" : "settings.wallpaper.generate")}
            </button>
          </div>
          {!imageOn && (
            <div className="mt-1.5 text-[11px] text-muted-foreground">
              {t("settings.wallpaper.needModel")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
