import { describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { MIGRATIONS } from '../src/migrations.ts';

const dir = path.join(import.meta.dir, '../src/migrations');

describe('embedded migrations', () => {
  test('match the .sql files on disk', async () => {
    const files = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();
    expect(MIGRATIONS.map((migration) => migration.version)).toEqual(files);
    for (const migration of MIGRATIONS) {
      const sql = await readFile(path.join(dir, migration.version), 'utf8');
      expect(migration.sql).toBe(sql);
    }
  });

  test('every migration is non-trivial SQL', () => {
    for (const migration of MIGRATIONS) {
      expect(migration.sql.length).toBeGreaterThan(100);
      expect(migration.sql).toMatch(/CREATE TABLE|ALTER TABLE|DO \$\$/);
    }
  });
});
