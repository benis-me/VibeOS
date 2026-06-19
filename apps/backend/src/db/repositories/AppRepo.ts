import type { AppDescriptor, AppManifest, PresetAppId } from "@vibeos/shared/domain";
import { ulid, stripEmoji } from "@vibeos/shared/util";
import { getDb } from "../database.ts";
import { enqueue } from "./writeQueue.ts";

interface AppRow {
  id: string;
  name: string;
  kind: string;
  preset_id: string | null;
  icon: string;
  manifest_json: string;
  is_installed: number;
  created_at: number;
  updated_at: number;
}

function toApp(row: AppRow): AppDescriptor {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind === "virtual" ? "virtual" : "preset",
    presetId: (row.preset_id as PresetAppId) ?? undefined,
    icon: row.icon,
    manifest: safeJson(row.manifest_json),
    isInstalled: row.is_installed === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listApps(): AppDescriptor[] {
  const db = getDb();
  return db
    .query<AppRow, []>("SELECT * FROM apps WHERE is_installed = 1 ORDER BY created_at")
    .all()
    .map(toApp);
}

export function getApp(id: string): AppDescriptor | null {
  const db = getDb();
  const row = db.query<AppRow, [string]>("SELECT * FROM apps WHERE id = ?").get(id);
  return row ? toApp(row) : null;
}

// icon = a lucide-react icon name (open-source icon set), rendered by <AppIcon>.
const PRESETS: Array<{ id: PresetAppId; name: string; icon: string; manifest: AppManifest }> = [
  { id: "browser", name: "Browser", icon: "globe", manifest: { description: "A web browser into the hallucinated internet.", category: "system", defaultSize: { w: 880, h: 600 }, chrome: "browser" } },
  { id: "command-line", name: "Terminal", icon: "square-terminal", manifest: { description: "A command line into the VibeOS shell.", category: "system", defaultSize: { w: 720, h: 460 } } },
  { id: "file-manager", name: "Files", icon: "folder", manifest: { description: "Browse the virtual filesystem.", category: "system", defaultSize: { w: 760, h: 520 } } },
  { id: "settings", name: "Settings", icon: "settings", manifest: { description: "System settings.", category: "system", defaultSize: { w: 900, h: 620 }, minSize: { w: 850, h: 480 }, singleInstance: true } },
  { id: "activity-monitor", name: "Activity Monitor", icon: "activity", manifest: { description: "Live view of AI agent runs, models, latency and token cost.", category: "system", defaultSize: { w: 720, h: 560 }, singleInstance: true } },
  { id: "app-store", name: "App Store", icon: "layout-grid", manifest: { description: "Browse, install, export and share apps.", category: "system", defaultSize: { w: 820, h: 580 }, singleInstance: true } },
  { id: "recycle-bin", name: "Recycle Bin", icon: "trash-2", manifest: { description: "Restore or permanently delete items you've thrown away.", category: "system", defaultSize: { w: 640, h: 500 }, singleInstance: true } },
];

/** Seed preset apps on first boot (idempotent: keyed by preset id). */
export function seedPresets(): Promise<void> {
  return enqueue(() => {
    const db = getDb();
    const now = Date.now();
    for (const p of PRESETS) {
      const exists = db
        .query<{ id: string }, [string]>("SELECT id FROM apps WHERE preset_id = ?")
        .get(p.id);
      if (exists) {
        // Keep preset metadata (name, icon, window sizes) in sync with the code.
        db.query(
          "UPDATE apps SET name = ?, icon = ?, manifest_json = ?, updated_at = ? WHERE preset_id = ?",
        ).run(p.name, p.icon, JSON.stringify(p.manifest), now, p.id);
        continue;
      }
      db.query(
        `INSERT INTO apps (id, name, kind, preset_id, icon, manifest_json, is_installed, created_at, updated_at)
         VALUES (?, ?, 'preset', ?, ?, ?, 1, ?, ?)`,
      ).run(p.id, p.name, p.id, p.icon, JSON.stringify(p.manifest), now, now);
    }
  });
}

export function installApp(input: {
  name: string;
  icon?: string;
  manifest?: AppManifest;
}): Promise<AppDescriptor> {
  return enqueue(() => {
    const db = getDb();
    const now = Date.now();
    const id = ulid(now);
    const name = stripEmoji(input.name) || "App";
    // icon should be a lucide icon name; strip emoji, default to a generic app icon.
    const icon = (input.icon ? stripEmoji(input.icon).trim() : "") || "app-window";
    db.query(
      `INSERT INTO apps (id, name, kind, preset_id, icon, manifest_json, is_installed, created_at, updated_at)
       VALUES (?, ?, 'virtual', NULL, ?, ?, 1, ?, ?)`,
    ).run(id, name, icon, JSON.stringify(input.manifest ?? {}), now, now);
    return getApp(id)!;
  });
}

const TRANSIENT_ID = "__transient__";

/**
 * A hidden anchor app for AI-spawned popup windows that aren't tied to a real
 * installed app. Not shown in the start menu (is_installed = 0).
 */
export function ensureTransientApp(): Promise<string> {
  return enqueue(() => {
    const db = getDb();
    const existing = db
      .query<{ id: string }, [string]>("SELECT id FROM apps WHERE id = ?")
      .get(TRANSIENT_ID);
    if (existing) return TRANSIENT_ID;
    const now = Date.now();
    db.query(
      `INSERT INTO apps (id, name, kind, preset_id, icon, manifest_json, is_installed, created_at, updated_at)
       VALUES (?, 'Window', 'virtual', NULL, 'app-window', '{}', 0, ?, ?)`,
    ).run(TRANSIENT_ID, now, now);
    return TRANSIENT_ID;
  });
}

function safeJson(s: string): AppManifest {
  try {
    return JSON.parse(s) as AppManifest;
  } catch {
    return {};
  }
}
