/**
 * Embedded migrations, generated from the .sql files so compiled binaries
 * carry the schema. Regenerate with `bun run gen:migrations`.
 */

import {
  migration_0001_init,
  migration_0002_templates_images,
  migration_0003_jsonb_normalize,
  migration_0004_template_tombstones,
  migration_0005_appliances,
  migration_0006_link_style_straight,
} from './migrations.generated.ts';

export interface Migration {
  version: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  { version: '0001_init.sql', sql: migration_0001_init },
  { version: '0002_templates_images.sql', sql: migration_0002_templates_images },
  { version: '0003_jsonb_normalize.sql', sql: migration_0003_jsonb_normalize },
  { version: '0004_template_tombstones.sql', sql: migration_0004_template_tombstones },
  { version: '0005_appliances.sql', sql: migration_0005_appliances },
  { version: '0006_link_style_straight.sql', sql: migration_0006_link_style_straight },
];
