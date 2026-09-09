import type {
  Settings,
  ProviderId,
  Locale,
  Skin,
  ProfileEntry,
  ProfileChange,
} from "@vibeos/shared/domain";
import { AI_PROVIDERS, DEFAULT_PROVIDER, skinIdSchema } from "@vibeos/shared/domain";
import { ulid } from "@vibeos/shared/util";
import { getDb } from "../database.ts";
import { enqueue } from "./writeQueue.ts";

interface SettingsRow {
  id: string;
  theme: string;
  provider: string | null;
  locale: string | null;
  skin: string | null;
  profile_entries_json: string;
  model_overrides_json: string;
  api_providers_json: string | null;
  prefs_json: string;
  updated_at: number;
}

const SETTINGS_ID = "settings";

function asProvider(v: string | null | undefined): ProviderId {
  return AI_PROVIDERS.find((p) => p.id === v)?.id ?? DEFAULT_PROVIDER;
}

function asLocale(v: string | null | undefined): Locale | undefined {
  return v === "zh" || v === "en" ? v : undefined;
}

function asSkin(v: string | null | undefined): Skin | undefined {
  return skinIdSchema.safeParse(v).success ? (v as Skin) : undefined;
}

const DEFAULTS: Settings = {
  theme: "dark",
  provider: DEFAULT_PROVIDER,
  profileEntries: [],
  modelOverrides: {},
  apiProviders: {},
  prefs: { proactiveAgents: true },
  updatedAt: 0,
};

// Cache: updateSettings/ensureSettings are the only writers (single-writer
// queue), so a clear-on-write cache stays correct and spares a SQLite read on
// every generation (SdkManager reads locale per run).
let cached: Settings | null = null;

export function loadSettings(): Settings {
  if (cached) return cached;
  const db = getDb();
  const row = db
    .query<SettingsRow, [string]>("SELECT * FROM settings WHERE id = ?")
    .get(SETTINGS_ID);
  if (!row) return { ...DEFAULTS };
  const entries = safeJson<ProfileEntry[]>(row.profile_entries_json);
  cached = {
    theme: row.theme === "light" ? "light" : "dark",
    provider: asProvider(row.provider),
    locale: asLocale(row.locale),
    skin: asSkin(row.skin),
    profileEntries: Array.isArray(entries) ? entries : [],
    modelOverrides: safeJson(row.model_overrides_json),
    apiProviders: safeJson(row.api_providers_json ?? "{}"),
    prefs: safeJson(row.prefs_json),
    updatedAt: row.updated_at,
  };
  return cached;
}

export function ensureSettings(): Promise<Settings> {
  return enqueue(() => {
    const db = getDb();
    const existing = db
      .query<SettingsRow, [string]>("SELECT * FROM settings WHERE id = ?")
      .get(SETTINGS_ID);
    if (existing) return loadSettings();
    const now = Date.now();
    db.query(
      `INSERT INTO settings (id, theme, provider, locale, model_overrides_json, api_providers_json, prefs_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      SETTINGS_ID,
      DEFAULTS.theme,
      DEFAULTS.provider,
      DEFAULTS.locale ?? null,
      JSON.stringify(DEFAULTS.modelOverrides),
      JSON.stringify(DEFAULTS.apiProviders),
      JSON.stringify(DEFAULTS.prefs),
      now,
    );
    cached = { ...DEFAULTS, updatedAt: now };
    return cached;
  });
}

export function updateSettings(
  update: Partial<Settings> | ((current: Settings) => Partial<Settings>),
): Promise<Settings> {
  return enqueue(() => {
    const db = getDb();
    const next = db.transaction(() => {
      const current = loadSettings();
      const partial = typeof update === "function" ? update(current) : update;
      // Deep-merge per-role model config so updating one field (e.g. effort)
      // doesn't wipe the rest of that role's config.
      const mergedOverrides = { ...current.modelOverrides };
      for (const [role, cfg] of Object.entries(partial.modelOverrides ?? {})) {
        mergedOverrides[role as keyof typeof mergedOverrides] = {
          ...mergedOverrides[role as keyof typeof mergedOverrides],
          ...cfg,
        };
      }
      // Same per-key shallow merge for API providers: changing one provider's key
      // (or model list) must not clobber the others or the rest of that entry.
      const mergedApi = { ...current.apiProviders };
      for (const [id, cfg] of Object.entries(partial.apiProviders ?? {})) {
        mergedApi[id] = { ...mergedApi[id], ...cfg };
      }
      const next: Settings = {
        theme: partial.theme ?? current.theme,
        provider: partial.provider ?? current.provider,
        locale: partial.locale ?? current.locale,
        skin: partial.skin ?? current.skin,
        profileEntries: partial.profileEntries ?? current.profileEntries,
        modelOverrides: mergedOverrides,
        apiProviders: mergedApi,
        prefs: { ...current.prefs, ...partial.prefs },
        updatedAt: Date.now(),
      };
      db.query(
        `UPDATE settings SET theme = ?, provider = ?, locale = ?, skin = ?, profile_entries_json = ?, model_overrides_json = ?, api_providers_json = ?, prefs_json = ?, updated_at = ? WHERE id = ?`,
      ).run(
        next.theme,
        next.provider,
        next.locale ?? null,
        next.skin ?? null,
        JSON.stringify(next.profileEntries),
        JSON.stringify(next.modelOverrides),
        JSON.stringify(next.apiProviders),
        JSON.stringify(next.prefs),
        next.updatedAt,
        SETTINGS_ID,
      );
      return next;
    })();
    cached = next;
    return next;
  });
}

export function updateProfile(change: ProfileChange): Promise<Settings> {
  return updateSettings((current) => {
    const entries = current.profileEntries;
    switch (change.action) {
      case "save": {
        const content = change.content.trim();
        if (!content) throw new Error("Personalization content cannot be empty");
        if (change.id && !entries.some((e) => e.id === change.id)) {
          throw new Error("Personalization entry no longer exists");
        }
        return {
          profileEntries: change.id
            ? entries.map((e) => (e.id === change.id ? { ...e, content } : e))
            : [...entries, { id: ulid(), content, enabled: true }],
        };
      }
      case "toggle":
        return {
          profileEntries: entries.map((e) =>
            e.id === change.id ? { ...e, enabled: change.enabled } : e,
          ),
        };
      case "remove":
        return { profileEntries: entries.filter((e) => e.id !== change.id) };
      case "disable-all":
        return { profileEntries: entries.map((e) => ({ ...e, enabled: false })) };
    }
  });
}

function safeJson<T>(s: string): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return {} as T;
  }
}
