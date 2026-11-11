-- M4: template image requirements/fault catalogs and image lookup indexes.

ALTER TABLE templates
  ADD COLUMN IF NOT EXISTS required_images jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE templates
  ADD COLUMN IF NOT EXISTS faults jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS nodes_template_idx ON nodes(template_id);

CREATE INDEX IF NOT EXISTS image_replicas_compute_idx ON image_replicas(compute_id);

CREATE INDEX IF NOT EXISTS templates_builtin_idx ON templates(builtin);
