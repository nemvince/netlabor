-- Self-service groups: the creator owns membership, while administrators keep
-- the existing ability to manage any group and assign global roles to it.

ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS groups_owner_idx ON groups(owner_id);
