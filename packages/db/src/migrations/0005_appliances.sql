-- Global OS image repository, appliance builds from it, and project-scoped
-- device templates.

CREATE TABLE IF NOT EXISTS os_images (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE,
  family text NOT NULL CHECK (family IN ('debian', 'ubuntu')),
  release text NOT NULL,
  arch text NOT NULL DEFAULT 'amd64',
  description text,
  source_url text,
  filename text NOT NULL,
  sha256 text,
  size_bytes bigint,
  status text NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'downloading', 'error')),
  error text,
  image_id uuid REFERENCES images(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS os_images_family_idx ON os_images(family);

CREATE TABLE IF NOT EXISTS appliance_builds (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  os_image_id uuid NOT NULL REFERENCES os_images(id) ON DELETE RESTRICT,
  desktop text NOT NULL DEFAULT 'none'
    CHECK (desktop IN ('none', 'xfce', 'gnome', 'kde', 'lxqt')),
  packages jsonb NOT NULL DEFAULT '[]'::jsonb,
  disk_gb integer NOT NULL DEFAULT 12,
  memory_mb integer NOT NULL DEFAULT 2048,
  cpus integer NOT NULL DEFAULT 2,
  compute_id uuid REFERENCES computes(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  progress double precision NOT NULL DEFAULT 0,
  message text,
  log text,
  image_id uuid REFERENCES images(id) ON DELETE SET NULL,
  error text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS appliance_builds_status_idx ON appliance_builds(status);
CREATE INDEX IF NOT EXISTS appliance_builds_image_idx ON appliance_builds(image_id);

ALTER TABLE templates
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS templates_project_idx ON templates(project_id);
