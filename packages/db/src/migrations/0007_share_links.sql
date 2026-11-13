-- Read-only, expiring share links. Each link owns a synthetic guest user that
-- holds the viewer role on one project, so the normal RBAC path enforces
-- read-only access without a parallel authorization model.

CREATE TABLE IF NOT EXISTS share_links (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  guest_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS share_links_project_idx ON share_links(project_id);
CREATE INDEX IF NOT EXISTS share_links_expires_idx ON share_links(expires_at);
