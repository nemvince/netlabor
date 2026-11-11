-- Built-in templates become editable and deletable: deletions are tombstoned
-- so the catalog seed does not resurrect a template the operator removed, and
-- edits survive restarts because seeding only inserts missing rows.
ALTER TABLE templates ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
