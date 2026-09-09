-- Runtime indexes point to content on the system disk. Legacy payloads are
-- cleared only after the startup data migration has backed up and verified them.
ALTER TABLE apps ADD COLUMN content_path TEXT;
ALTER TABLE app_memory ADD COLUMN snapshot_path TEXT;
ALTER TABLE images ADD COLUMN content_path TEXT;
CREATE TABLE storage_version (
  version INTEGER PRIMARY KEY,
  backup_path TEXT,
  completed_at INTEGER NOT NULL
);
