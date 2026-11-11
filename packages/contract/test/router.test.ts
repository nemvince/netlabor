import { describe, expect, test } from 'bun:test';
import { ProcedureMetaSchema } from '../src/authz.ts';
import { procedurePaths, router } from '../src/router.ts';

interface ProcedureNode {
  meta: unknown;
  path: string[];
}

function collectProcedures(node: unknown, path: string[] = []): ProcedureNode[] {
  if (typeof node !== 'object' || node === null) return [];
  const out: ProcedureNode[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === '~orpc') continue;
    const nextPath = [...path, key];
    if (value && typeof value === 'object' && '~orpc' in value) {
      const def = value['~orpc'];
      if (
        typeof def === 'object' &&
        def !== null &&
        ('inputSchema' in def || 'outputSchema' in def)
      ) {
        out.push({ meta: 'meta' in def ? def.meta : undefined, path: nextPath });
        continue;
      }
    }
    out.push(...collectProcedures(value, nextPath));
  }
  return out;
}

describe('router contract', () => {
  const procedures = collectProcedures(router);

  test('every procedure carries valid metadata', () => {
    const invalid = procedures.filter(
      (procedure) => !ProcedureMetaSchema.safeParse(procedure.meta).success,
    );
    expect(invalid.map((procedure) => procedure.path.join('.'))).toEqual([]);
  });

  test('authenticated procedures declare a privilege or are session-only', () => {
    const missing = procedures.filter(({ meta }) => {
      const parsed = ProcedureMetaSchema.safeParse(meta);
      if (!parsed.success) return false;
      const policy = parsed.data.authz;
      if (policy.mode === 'public') return false;
      if (policy.privilege || (policy.also && policy.also.length > 0)) return false;
      return policy.sessionOnly !== true && policy.mode !== 'session';
    });
    expect(missing.map((procedure) => procedure.path.join('.'))).toEqual([]);
  });

  test('procedurePaths enumerates the same procedures', () => {
    expect(procedurePaths(router).sort()).toEqual(procedures.map((p) => p.path.join('.')).sort());
  });

  test('mcp tools reference real procedures', () => {
    const names = new Set(procedures.map((p) => p.path.join('.')));
    const tools = procedures
      .map((p) => ProcedureMetaSchema.safeParse(p.meta))
      .flatMap((parsed) => (parsed.success && parsed.data.mcp ? [parsed.data.mcp.name] : []));
    expect(tools.length).toBe(new Set(tools).size);
    expect(names.size).toBeGreaterThan(50);
  });
});
