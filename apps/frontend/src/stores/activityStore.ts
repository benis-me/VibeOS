import { create } from "zustand";
import type { AgentRun } from "@vibeos/shared";
import { wsClient } from "@/lib/ws";

/** Page size for scroll pagination (the boot payload sends the first ~50). */
const PAGE = 40;

interface ActivityState {
  runs: AgentRun[];
  hasMore: boolean;
  loading: boolean;
  /** Initial set (boot). */
  setAll: (runs: AgentRun[]) => void;
  /** Older page appended on scroll. */
  appendPage: (runs: AgentRun[], hasMore: boolean) => void;
  /** Live insert/update of a single run. */
  upsert: (run: AgentRun) => void;
  /** Request the next older page (no-op while loading or exhausted). */
  fetchMore: () => void;
}

/** Live feed of agent runs for the Activity Monitor (boot + s2c.agent.run + paging). */
export const useActivityStore = create<ActivityState>((set, get) => ({
  runs: [],
  hasMore: false,
  loading: false,
  setAll: (runs) => set({ runs, hasMore: runs.length >= 50, loading: false }),
  appendPage: (runs, hasMore) =>
    set((s) => {
      const seen = new Set(s.runs.map((r) => r.id));
      return { runs: [...s.runs, ...runs.filter((r) => !seen.has(r.id))], hasMore, loading: false };
    }),
  upsert: (run) =>
    set((s) => {
      const i = s.runs.findIndex((r) => r.id === run.id);
      if (i === -1) return { runs: [run, ...s.runs] };
      const next = s.runs.slice();
      next[i] = run;
      return { runs: next };
    }),
  fetchMore: () => {
    const s = get();
    if (s.loading || !s.hasMore || s.runs.length === 0) return;
    set({ loading: true });
    wsClient.send("c2s.activity.fetch", { before: s.runs[s.runs.length - 1]!.startedAt, limit: PAGE });
  },
}));
