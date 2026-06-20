import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import type { AppDescriptor } from "@vibeos/shared";
import { AppIcon } from "@/components/AppIcon";
import { useAppStore } from "@/stores/appStore";
import { wsClient } from "@/lib/ws";
import { useT } from "@/lib/i18n";

const GRID = "grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2.5";

// Seed apps the user can install on demand — the AI generates them fresh on open.
const TEMPLATES: { name: string; icon: string; description: string }[] = [
  {
    name: "Notes",
    icon: "notebook-pen",
    description: "A minimal note-taking app with a list and an editor.",
  },
  {
    name: "Calculator",
    icon: "calculator",
    description: "A clean calculator with a keypad and a running tape.",
  },
  {
    name: "Music",
    icon: "music",
    description: "A music player with a now-playing view and a playlist.",
  },
  {
    name: "Weather",
    icon: "cloud-sun",
    description: "Current conditions and a multi-day forecast.",
  },
  { name: "Calendar", icon: "calendar", description: "A month calendar with events." },
  {
    name: "Paint",
    icon: "palette",
    description: "A drawing canvas with tools and a color palette.",
  },
];

export function AppStoreApp() {
  const t = useT();
  const appMap = useAppStore((s) => s.apps);
  const installed = useMemo(
    () => Object.values(appMap).filter((a) => a.isInstalled && a.id !== "__transient__"),
    [appMap],
  );
  const [importText, setImportText] = useState("");

  const open = (id: string) => wsClient.send("c2s.window.open", { appId: id });
  const exportApp = (id: string) => wsClient.send("c2s.app.export", { appId: id });
  const installTemplate = (tpl: (typeof TEMPLATES)[number]) =>
    wsClient.send("c2s.app.import", {
      json: JSON.stringify({
        name: tpl.name,
        icon: tpl.icon,
        manifest: { description: tpl.description },
      }),
    });
  const doImport = () => {
    if (!importText.trim()) return;
    wsClient.send("c2s.app.import", { json: importText.trim() });
    setImportText("");
  };

  return (
    <div className="h-full overflow-auto bg-background text-foreground">
      <div className="mx-auto max-w-3xl p-6">
        <SectionTitle>{t("store.installed")}</SectionTitle>
        {installed.length === 0 ? (
          <Empty>{t("store.empty")}</Empty>
        ) : (
          <div className={GRID}>
            {installed.map((a) => (
              <AppCard
                key={a.id}
                app={a}
                onOpen={() => open(a.id)}
                onExport={() => exportApp(a.id)}
                t={t}
              />
            ))}
          </div>
        )}

        <SectionTitle className="mt-7">{t("store.templates")}</SectionTitle>
        <div className={GRID}>
          {TEMPLATES.map((tpl) => (
            <button
              key={tpl.name}
              onClick={() => installTemplate(tpl)}
              className="vibe-group flex flex-col gap-2 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-accent/40"
            >
              <AppIcon name={tpl.icon} label={tpl.name} className="size-7" />
              <div className="text-[13px] font-medium">{tpl.name}</div>
              <div className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                {tpl.description}
              </div>
            </button>
          ))}
        </div>

        <SectionTitle className="mt-7">{t("store.import")}</SectionTitle>
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder={t("store.import.hint")}
          className="h-24 w-full resize-y rounded-xl border bg-card p-3 font-mono text-[11px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        <button
          onClick={doImport}
          disabled={!importText.trim()}
          className="vibe-btn mt-2 rounded-lg border bg-card px-3 py-1.5 text-[13px] transition-colors hover:bg-accent disabled:opacity-50"
        >
          {t("store.import")}
        </button>
      </div>
    </div>
  );
}

function AppCard({
  app,
  onOpen,
  onExport,
  t,
}: {
  app: AppDescriptor;
  onOpen: () => void;
  onExport: () => void;
  t: (k: string) => string;
}) {
  const subtitle = app.manifest.seedHtml
    ? t("store.frozen")
    : (app.manifest.description as string | undefined);
  return (
    <div className="vibe-group flex flex-col gap-2 rounded-xl border bg-card p-3">
      <button onClick={onOpen} className="flex items-start gap-2.5 text-left">
        <AppIcon
          name={app.icon}
          presetId={app.presetId}
          label={app.name}
          className="size-7 shrink-0"
        />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium">{app.name}</div>
          {subtitle && (
            <div
              className={
                "line-clamp-2 text-[11px] leading-relaxed " +
                (app.manifest.seedHtml ? "text-brand" : "text-muted-foreground")
              }
            >
              {subtitle}
            </div>
          )}
        </div>
      </button>
      <div className="mt-auto flex gap-1.5">
        <button
          onClick={onOpen}
          className="vibe-btn flex-1 rounded-md border px-2 py-1 text-[11px] transition-colors hover:bg-accent"
        >
          {t("store.open")}
        </button>
        <button
          onClick={onExport}
          title={t("store.export")}
          className="vibe-btn rounded-md border px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Download className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={`mb-3 text-[13px] font-medium text-foreground/70 ${className ?? ""}`}>
      {children}
    </h2>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
