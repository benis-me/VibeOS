-- Multi-provider + i18n: the active AI backend and the UI/content language.
-- `provider` defaults to CodeBuddy (the original backend); NULL `locale` means
-- "not chosen yet" so the frontend follows the browser on first boot.
ALTER TABLE settings ADD COLUMN provider TEXT NOT NULL DEFAULT 'codebuddy';
ALTER TABLE settings ADD COLUMN locale TEXT;
