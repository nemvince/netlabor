import { describe, expect, test } from 'bun:test';
import type { SQL } from 'bun';
import { getSettings, updateSettings } from '../src/services/rbac.ts';

interface Call {
  sql: string;
  params: unknown[];
}

/**
 * `updateSettings` used to bind JS numbers straight into `$2::jsonb`, which
 * Postgres rejects ("cannot cast type integer to jsonb"). The binding must be
 * JSON text for every value type, so this pins the shape a recording stub sees.
 */
function recordingSql(calls: Call[], rows: unknown[] = []): SQL {
  const stub = {
    unsafe: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      return rows;
    },
  };
  return stub as unknown as SQL;
}

describe('updateSettings', () => {
  test('binds every value as JSON text, including numbers and booleans', async () => {
    const calls: Call[] = [];
    await updateSettings(recordingSql(calls), {
      'ui.defaultConsoleRows': 30,
      'ui.defaultConsoleCols': 80,
      'project.autoCloseIdleMinutes': null,
      'feature.flag': true,
      'feature.label': 'lab',
    });

    const writes = calls.filter((call) => call.sql.includes('INSERT INTO settings'));
    expect(writes).toHaveLength(5);
    expect(writes.map((call) => call.params[1])).toEqual([
      '30',
      '80',
      'null',
      'true',
      '"lab"',
    ]);
    for (const call of writes) {
      expect(typeof call.params[0]).toBe('string');
      expect(typeof call.params[1]).toBe('string');
    }
  });

  test('reads defaults back when the table is empty', async () => {
    const calls: Call[] = [];
    const settings = await getSettings(recordingSql(calls));
    expect(settings).toEqual({
      'ui.defaultConsoleRows': 24,
      'ui.defaultConsoleCols': 80,
      'project.autoCloseIdleMinutes': 10,
    });
  });
});
