-- Preserve the former free-text profile as one enabled entry, exactly once.
ALTER TABLE settings ADD COLUMN profile_entries_json TEXT NOT NULL DEFAULT '[]';

UPDATE settings
SET profile_entries_json = json_array(json_object(
  'id', 'legacy-profile',
  'content', user_profile,
  'enabled', json('true')
))
WHERE length(trim(coalesce(user_profile, ''))) > 0;
