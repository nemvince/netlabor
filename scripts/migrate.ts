/** Run database migrations against NB_DATABASE_URL. */

import { createDb, migrate } from '@netlabor/db';

const url = process.env.NB_DATABASE_URL;
if (!url) {
  console.error('NB_DATABASE_URL is required');
  process.exit(1);
}

const db = createDb(url);
try {
  const result = await migrate(db);
  console.log(`applied ${result.applied.length} migration(s), skipped ${result.skipped.length}`);
  for (const version of result.applied) console.log(`  + ${version}`);
} finally {
  await db.close();
}
