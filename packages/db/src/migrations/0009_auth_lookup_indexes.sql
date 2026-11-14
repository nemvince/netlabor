-- Indexes for the per-request privilege lookup: both tables are queried by
-- the second column of their primary/unique key, so they were scanned whole.

CREATE INDEX IF NOT EXISTS group_members_user_idx ON group_members(user_id);

CREATE INDEX IF NOT EXISTS project_grants_subject_idx
  ON project_grants(subject_type, subject_id);
