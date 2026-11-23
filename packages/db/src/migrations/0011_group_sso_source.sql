-- Keep IdP-mapped groups distinct from self-service groups with the same name.
-- A user must never be pulled into a group an administrator created (or later
-- assigned roles to) just because they reserved its name first.

ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS sso_provider_id uuid REFERENCES oidc_providers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS groups_sso_provider_idx ON groups(sso_provider_id);
