/**
 * Template scope scoping is enforced in SQL, so these tests drive
 * `listTemplates` through a recording stub and assert the emitted predicate
 * and parameter order. No database is needed.
 */

import { describe, expect, test } from 'bun:test';
import type { TemplateListInput, TemplateRow } from '@netlabor/contract';
import type { SQL } from 'bun';
import { listTemplates } from '../src/services/templates.ts';

const PROJECT_ID = '11111111-1111-7111-8111-111111111111';

interface Call {
  query: string;
  params: unknown[];
}

function templateRecord(id: string, projectId: string | null) {
  return {
    id,
    name: `template-${id}`,
    node_type: 'qemu' as const,
    category: 'General',
    symbol: 'router',
    default_name_format: '{name}-{index}',
    compute_id: null,
    pool_id: null,
    properties: {},
    required_images: [],
    faults: [],
    project_id: projectId,
    builtin: false,
    created_by: null,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
  };
}

/** Records the statement and returns two rows: one global, one project-owned. */
function recordingDb(rows: unknown[]): { db: SQL; calls: Call[] } {
  const calls: Call[] = [];
  const db = {
    unsafe: async (query: string, params: unknown[] = []) => {
      calls.push({ query, params });
      return rows;
    },
  } as unknown as SQL;
  return { db, calls };
}

describe('listTemplates scope', () => {
  test('without a project returns global templates only', async () => {
    const { db, calls } = recordingDb([templateRecord('a', null), templateRecord('b', PROJECT_ID)]);
    const rows = await listTemplates(db, { limit: 200, offset: 0 });

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.query).toContain('project_id IS NULL OR project_id = $1::uuid');
    expect(call?.params).toEqual([null, null, null, null, 200, 0]);
    // Scoping is a SQL predicate, so the stub rows come back unfiltered.
    expect(rows.map((row: TemplateRow) => row.projectId)).toEqual([null, PROJECT_ID]);
  });

  test('with a project widens the scope to the global library plus that project', async () => {
    const { db, calls } = recordingDb([templateRecord('a', null), templateRecord('b', PROJECT_ID)]);
    await listTemplates(db, {
      projectId: PROJECT_ID,
      nodeType: 'qemu',
      category: 'General',
      search: 'rout',
      limit: 10,
      offset: 20,
    });

    const [call] = calls;
    expect(call?.params).toEqual([PROJECT_ID, 'qemu', 'General', 'rout', 10, 20]);
    expect(call?.query).toContain('deleted_at IS NULL');
    expect(call?.query).toContain('ORDER BY category ASC, name ASC');
  });

  test('keeps filter, limit, and offset parameter positions', async () => {
    const { db, calls } = recordingDb([]);
    const input: TemplateListInput = { limit: 1, offset: 2 };
    await listTemplates(db, input);

    const [call] = calls;
    expect(call?.query).toContain('LIMIT $5 OFFSET $6');
    expect(call?.params.slice(1)).toEqual([null, null, null, 1, 2]);
  });
});

describe('TemplateRow.projectId', () => {
  test('maps the stored scope', async () => {
    const { db } = recordingDb([templateRecord('a', PROJECT_ID)]);
    const [row] = await listTemplates(db, { limit: 1, offset: 0 });
    expect(row?.projectId).toBe(PROJECT_ID);
  });
});
