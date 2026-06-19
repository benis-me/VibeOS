-- Persisted Dock / taskbar order for windows (drag-to-reorder).
ALTER TABLE windows ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
