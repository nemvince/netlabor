/** PostgreSQL access: connection factory, transactions, and migrations. */

import { SQL } from 'bun';
import { MIGRATIONS, type Migration } from './migrations.ts';

export * from './json.ts';

export type Db = SQL;

export function createDb(url: string, options?: { max?: number }): SQL {
  return new SQL(url, {
    max: options?.max ?? 10,
    idleTimeout: 30,
    connectionTimeout: 10,
  });
}

export async function withTransaction<T>(db: SQL, fn: (tx: SQL) => Promise<T>): Promise<T> {
  return db.begin((tx) => fn(tx as SQL));
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Apply every known migration once, in lexical order, inside its own
 * transaction. A failed migration rolls back that file and aborts the run.
 */
export async function migrate(
  db: SQL,
  options?: { migrations?: Migration[] },
): Promise<MigrationResult> {
  const migrations = [...(options?.migrations ?? MIGRATIONS)].sort((a, b) =>
    a.version.localeCompare(b.version),
  );
  await db.unsafe(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

  const existing = await db.unsafe<{ version: string }[]>('SELECT version FROM schema_migrations');
  const applied = new Set(existing.map((row) => row.version));
  const result: MigrationResult = { applied: [], skipped: [] };
  for (const migration of migrations) {
    if (applied.has(migration.version)) {
      result.skipped.push(migration.version);
      continue;
    }
    await db.begin(async (tx) => {
      await (tx as SQL).unsafe(migration.sql);
      await (tx as SQL).unsafe('INSERT INTO schema_migrations (version) VALUES ($1)', [
        migration.version,
      ]);
    });
    result.applied.push(migration.version);
  }
  return result;
}
