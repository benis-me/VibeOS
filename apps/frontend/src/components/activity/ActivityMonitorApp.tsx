import { useMemo } from "react";
import { Activity, Loader2, Square } from "lucide-react";
import type { AgentRun } from "@vibeos/shared";
import { useActivityStore } from "@/stores/activityStore";
import { wsClient } from "@/lib/ws";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type T = (k: string) => string;

const DOT: Record<string, string> = {
  running: "bg-brand animate-pulse",
  ok: "bg-run",
  error: "bg-destructive",
  aborted: "bg-warn",
};

const COLS =
  "grid grid-cols-[minmax(104px,1.2fr)_minmax(130px,1.8fr)_minmax(80px,0.9fr)_66px_50px_58px_62px_60px] gap-3";

const tok = (r: AgentRun) => (r.inputTokens ?? 0) + (r.outputTokens ?? 0);

export function ActivityMonitorApp() {
  const t = useT();
  const runs = useActivityStore((s) => s.runs);
  const hasMore = useActivityStore((s) => s.hasMore);
  const loading = useActivityStore((s) => s.loading);
  const fetchMore = useActivityStore((s) => s.fetchMore);

  const summary = useMemo(() => {
    let tokens = 0;
    let cost = 0;
    let running = 0;
    let errors = 0;
    let durSum = 0;
    let durN = 0;
    for (const r of runs) {
      tokens += tok(r);
      cost += r.costUsd ?? 0;
      if (r.status === "running") running++;
      if (r.status === "error") errors++;
      if (r.endedAt) {
        durSum += r.endedAt - r.startedAt;
        durN++;
      }
    }
    return {
      count: runs.length,
      tokens,
      cost,
      running,
      errRate: runs.length ? errors / runs.length : 0,
      avgMs: durN ? durSum / durN : 0,
    };
  }, [runs]);

  // Recent runs oldest→newest for the timeline chart.
  const chart = useMemo(() => runs.slice(0, 64).reverse(), [runs]);
  const maxTok = useMemo(() => Math.max(1, ...chart.map(tok)), [chart]);

  const byModel = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of runs) m.set(r.model ?? "—", (m.get(r.model ?? "—") ?? 0) + tok(r));
    const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const max = Math.max(1, ...top.map((x) => x[1]));
    return { top, max };
  }, [runs]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 280) fetchMore();
  };

  if (runs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-background text-muted-foreground">
        <Activity className="size-6 opacity-40" />
        <span className="text-sm">{t("activity.empty")}</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* ---- dashboard ---- */}
      <div className="shrink-0 border-b">
        <div className="flex items-center justify-between px-5 pt-4">
          <h1 className="text-[13px] font-semibold tracking-tight">{t("activity.recent")}</h1>
          {summary.running > 0 && (
            <span className="flex items-center gap-1.5 text-[11px] text-brand">
              <span className="size-1.5 animate-pulse rounded-full bg-brand" />
              {summary.running} {t("activity.running")}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-x-7 gap-y-2 px-5 py-3">
          <Metric label={t("activity.runs")} value={String(summary.count)} />
          <Metric label={t("activity.tokens")} value={fmtTokens(summary.tokens)} />
          <Metric label={t("activity.cost")} value={fmtCost(summary.cost)} />
          <Metric
            label={t("activity.avgLatency")}
            value={summary.avgMs ? `${(summary.avgMs / 1000).toFixed(1)}s` : "—"}
          />
          <Metric
            label={t("activity.errRate")}
            value={`${(summary.errRate * 100).toFixed(0)}%`}
            warn={summary.errRate > 0.2}
          />
        </div>

        <div className="grid grid-cols-[1.7fr_1fr] gap-5 px-5 pb-4">
          <Panel
            title={t("activity.tokenUsage")}
            aside={
              <span className="flex items-center gap-2.5 text-[10px] text-muted-foreground">
                <Legend className="bg-brand/40" label={t("activity.in")} />
                <Legend className="bg-brand" label={t("activity.out")} />
              </span>
            }
          >
            <div className="flex h-[72px] items-end gap-px">
              {chart.map((r) => {
                const total = tok(r);
                const h = (total / maxTok) * 100;
                const outShare = total ? ((r.outputTokens ?? 0) / total) * 100 : 0;
                return (
                  <div
                    key={r.id}
                    className="group relative flex h-full flex-1 flex-col justify-end"
                    style={{ minWidth: 2 }}
                    title={`${r.appName ?? t(`activity.role.${r.role}`)} · ${r.model ?? "—"}\n${fmtTokens(total)} tok · ${fmtCost(r.costUsd ?? 0)}`}
                  >
                    <div
                      className={cn(
                        "w-full rounded-[2px] bg-brand/35 transition-colors group-hover:bg-brand/60",
                        total === 0 && "bg-border",
                      )}
                      style={{ height: `${Math.max(total === 0 ? 6 : 3, h)}%` }}
                    >
                      <div
                        className="w-full rounded-t-[2px] bg-brand"
                        style={{ height: `${outShare}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title={t("activity.byModel")}>
            <div className="flex flex-col gap-1.5 pt-0.5">
              {byModel.top.map(([model, n]) => (
                <div key={model} className="flex items-center gap-2 text-[11px]">
                  <span className="w-24 shrink-0 truncate text-muted-foreground" title={model}>
                    {model}
                  </span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-brand"
                      style={{ width: `${(n / byModel.max) * 100}%` }}
                    />
                  </span>
                  <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
                    {fmtTokens(n)}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {/* ---- runs table ---- */}
      <div
        className={cn(
          COLS,
          "shrink-0 border-b bg-muted/30 px-5 py-1.5 text-[10px] font-medium uppercase text-muted-foreground",
        )}
      >
        <span>{t("activity.col.app")}</span>
        <span>{t("activity.col.summary")}</span>
        <span>{t("activity.col.model")}</span>
        <span>{t("activity.col.status")}</span>
        <span className="text-right">{t("activity.col.time")}</span>
        <span className="text-right">{t("activity.col.tokens")}</span>
        <span className="text-right">{t("activity.col.cost")}</span>
        <span className="text-right">{t("activity.col.action")}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto" onScroll={onScroll}>
        {runs.map((r) => (
          <RunRow key={r.id} r={r} t={t} />
        ))}
        {(loading || hasMore) && (
          <div className="flex items-center justify-center gap-2 py-3 text-[11px] text-muted-foreground">
            {loading && <Loader2 className="size-3.5 animate-spin" />}
            {t("activity.loading")}
          </div>
        )}
      </div>
    </div>
  );
}

function RunRow({ r, t }: { r: AgentRun; t: T }) {
  const dur = r.endedAt ? `${((r.endedAt - r.startedAt) / 1000).toFixed(1)}s` : "·";
  const total = tok(r);
  return (
    <div
      className={cn(
        COLS,
        "items-center border-b border-border/50 px-5 py-2 text-[12px] transition-colors hover:bg-accent/30",
      )}
    >
      <div className="min-w-0">
        <div className="truncate font-medium">{r.appName ?? t(`activity.role.${r.role}`)}</div>
        <div className="truncate text-[10px] text-muted-foreground">
          {t(`activity.role.${r.role}`)}
        </div>
      </div>
      <div
        className={cn(
          "min-w-0 truncate",
          r.status === "error" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {r.status === "error" ? r.error : (r.summary ?? "—")}
      </div>
      <div className="min-w-0 truncate text-[11px] text-muted-foreground" title={r.model}>
        {r.model ?? "—"}
      </div>
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className={cn("size-1.5 shrink-0 rounded-full", DOT[r.status])} />
        <span className="truncate text-muted-foreground">{t(`activity.status.${r.status}`)}</span>
      </div>
      <div className="text-right tabular-nums text-muted-foreground">{dur}</div>
      <div className="text-right tabular-nums text-muted-foreground">
        {total ? fmtTokens(total) : "—"}
      </div>
      <div className="text-right tabular-nums text-muted-foreground">{fmtCost(r.costUsd ?? 0)}</div>
      <div className="flex justify-end">
        {r.status === "running" ? (
          <button
            onClick={() => wsClient.send("c2s.activity.stop", { runId: r.id })}
            title={t("activity.stop")}
            className="flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-destructive hover:bg-destructive hover:text-white"
          >
            <Square className="size-2.5" fill="currentColor" /> {t("activity.stop")}
          </button>
        ) : (
          <span className="text-[11px] text-muted-foreground/40">—</span>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-[15px] font-semibold tabular-nums leading-none",
          warn && "text-destructive",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function Panel({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium text-foreground/70">{title}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("size-2 rounded-[2px]", className)} />
      {label}
    </span>
  );
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function fmtCost(c: number): string {
  if (!c) return "—";
  if (c >= 1) return `$${c.toFixed(2)}`;
  if (c >= 0.01) return `$${c.toFixed(3)}`;
  return `$${c.toFixed(4)}`;
}
