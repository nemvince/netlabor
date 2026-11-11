-- Repair jsonb columns that were stored as JSON strings (double-encoded) by
-- older writes. New code binds objects directly, so this is one idempotent
-- pass over the affected columns.

DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('oidc_providers', 'group_mappings'),
      ('user_preferences', 'value'),
      ('computes', 'capabilities'),
      ('images', 'metadata'),
      ('templates', 'properties'),
      ('templates', 'required_images'),
      ('templates', 'faults'),
      ('project_templates', 'topology'),
      ('settings', 'value'),
      ('projects', 'variables'),
      ('projects', 'scene'),
      ('nodes', 'properties'),
      ('links', 'style'),
      ('links', 'filters'),
      ('links', 'capture'),
      ('links', 'dataplane'),
      ('drawings', 'style'),
      ('faults', 'target'),
      ('faults', 'params'),
      ('faults', 'recovery'),
      ('events', 'payload'),
      ('audit_log', 'data'),
      ('jobs', 'payload'),
      ('jobs', 'result')
    ) AS t(tbl, col)
  LOOP
    EXECUTE format(
      'UPDATE %I SET %I = (%I #>> $1::text[])::jsonb WHERE %I IS NOT NULL AND jsonb_typeof(%I) = $2',
      target.tbl, target.col, target.col, target.col, target.col
    ) USING '{}', 'string';
  END LOOP;
END $$;
