-- Link lines: switch every stored link to GNS3/Packet Tracer-style straight
-- point-to-point lines; orthogonal/bezier stay opt-in per link.
DO $$
BEGIN
  UPDATE links
     SET style = jsonb_set(style, '{type}', '"straight"'::jsonb, true)
   WHERE style->>'type' = 'orthogonal' OR style->>'type' IS NULL;
END
$$;
