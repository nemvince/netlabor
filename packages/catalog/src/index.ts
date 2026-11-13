/**
 * Seeded device catalog: built-in templates and symbols. Seeding only inserts
 * missing rows, so edits and tombstones persist across restarts.
 */

import type { Logger } from '@netlabor/shared';
import type { SQL } from 'bun';
import { catalogOsImages } from './os-images.ts';
import { catalogSymbols } from './symbols.ts';
import { catalogTemplates } from './templates.ts';

export * from './fault-catalog.ts';
export * from './marketplace.ts';
export * from './os-images.ts';
export * from './ports.ts';
export * from './setup-presets.ts';
export * from './software.ts';
export * from './symbols.ts';
export * from './templates.ts';

export async function seedCatalog(db: SQL, options?: { logger?: Logger }): Promise<void> {
  for (const template of catalogTemplates) {
    await db.unsafe(
      `INSERT INTO templates (id, name, node_type, category, symbol, default_name_format,
                              properties, required_images, faults, builtin)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, true)
       ON CONFLICT (id) DO NOTHING`,
      [
        template.id,
        template.name,
        template.nodeType,
        template.category,
        template.symbol,
        template.defaultNameFormat,
        template.properties,
        template.requiredImages,
        template.faults,
      ],
    );
  }
  for (const osImage of catalogOsImages) {
    await db.unsafe(
      `INSERT INTO os_images (id, name, family, release, arch, description, source_url, filename)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (name) DO UPDATE
         SET source_url = EXCLUDED.source_url,
             description = EXCLUDED.description,
             release = EXCLUDED.release,
             updated_at = now()
       WHERE os_images.image_id IS NULL`,
      [
        osImage.id,
        osImage.name,
        osImage.family,
        osImage.release,
        osImage.arch,
        osImage.description,
        osImage.sourceUrl,
        osImage.filename,
      ],
    );
  }
  for (const symbol of catalogSymbols) {
    await db.unsafe(
      `INSERT INTO symbols (id, name, svg, theme, builtin) VALUES ($1, $2, $3, NULL, true)
       ON CONFLICT (id) DO UPDATE SET svg = EXCLUDED.svg, name = EXCLUDED.name
       WHERE symbols.builtin = true`,
      [symbol.id, symbol.name, symbol.svg],
    );
  }
  // Drop retired builtin symbols unless something still points at them.
  const symbolIds = catalogSymbols.map((symbol) => symbol.id);
  await db.unsafe(
    `DELETE FROM symbols s
      WHERE s.builtin = true
        AND NOT (s.id = ANY($1::text[]))
        AND NOT EXISTS (SELECT 1 FROM templates t WHERE t.symbol = s.id)
        AND NOT EXISTS (SELECT 1 FROM nodes n WHERE n.symbol = s.id)`,
    [symbolIds],
  );
  options?.logger?.debug('catalog seeded', {
    templates: catalogTemplates.length,
    symbols: catalogSymbols.length,
    osImages: catalogOsImages.length,
  });
}
