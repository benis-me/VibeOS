-- VibeOS initial schema (migration 0001)

CREATE TABLE IF NOT EXISTS kernel_state (
  id TEXT PRIMARY KEY,
  boot_count INTEGER NOT NULL DEFAULT 0,
  last_boot_at INTEGER,
  global_state_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  preset_id TEXT,
  icon TEXT NOT NULL DEFAULT '',
  manifest_json TEXT NOT NULL DEFAULT '{}',
  is_installed INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS windows (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES apps(id),
  title TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'app',
  x REAL NOT NULL DEFAULT 80,
  y REAL NOT NULL DEFAULT 80,
  w REAL NOT NULL DEFAULT 720,
  h REAL NOT NULL DEFAULT 480,
  z INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'normal',
  is_open INTEGER NOT NULL DEFAULT 1,
  focused INTEGER NOT NULL DEFAULT 0,
  opened_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_windows_open ON windows(is_open);

CREATE TABLE IF NOT EXISTS app_memory (
  window_id TEXT PRIMARY KEY REFERENCES windows(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  html_snapshot TEXT NOT NULL DEFAULT '',
  episode_summary TEXT NOT NULL DEFAULT '',
  sdk_session_id TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS interactions (
  id TEXT PRIMARY KEY,
  window_id TEXT REFERENCES windows(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  op_kind TEXT NOT NULL,
  op_payload_json TEXT NOT NULL,
  result_summary TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_interactions_win ON interactions(window_id, seq);

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  summary TEXT NOT NULL,
  salience REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_episodes_scope ON episodes(scope, created_at);

CREATE TABLE IF NOT EXISTS vfs_nodes (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES vfs_nodes(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  mime TEXT,
  content TEXT,
  target_app_id TEXT,
  location TEXT NOT NULL DEFAULT 'desktop',
  x REAL,
  y REAL,
  deleted_at INTEGER,
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vfs_parent ON vfs_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_vfs_location ON vfs_nodes(location);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  app_id TEXT,
  source TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  action_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_unread ON notifications(read, created_at);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  trigger TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL,
  prompt_tokens INTEGER,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_role ON agent_runs(role, started_at);

CREATE TABLE IF NOT EXISTS agent_logs (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES agent_runs(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  data_json TEXT,
  ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  theme TEXT NOT NULL DEFAULT 'dark',
  model_overrides_json TEXT NOT NULL DEFAULT '{}',
  prefs_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);
