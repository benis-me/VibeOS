CREATE TABLE skins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  foundation TEXT,
  initial_path TEXT NOT NULL,
  active_version_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE skin_versions (
  id TEXT PRIMARY KEY,
  skin_id TEXT NOT NULL REFERENCES skins(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  path TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(skin_id, number)
);
CREATE TABLE skin_requests (
  id TEXT PRIMARY KEY,
  skin_id TEXT NOT NULL REFERENCES skins(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  base_version_id TEXT,
  status TEXT NOT NULL,
  chars INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  version_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX skin_one_running_request ON skin_requests(skin_id) WHERE status IN ('generating', 'validating');
