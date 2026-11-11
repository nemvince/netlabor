/** Privilege required by a contract procedure, read from its authz metadata. */

import type { Privilege } from '@netlabor/contract';
import { router as contract, ProcedureMetaSchema } from '@netlabor/contract';

function procedureDef(path: string): Record<string, unknown> | null {
  const segments = path.split('.');
  let current: unknown = contract;
  for (const segment of segments) {
    if (!current || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[segment];
  }
  if (!current || typeof current !== 'object' || !('~orpc' in current)) return null;
  const def = current['~orpc'];
  return typeof def === 'object' && def !== null ? (def as Record<string, unknown>) : null;
}

export function procedurePrivilege(path: string): Privilege | null {
  const def = procedureDef(path);
  if (!def) return null;
  const parsed = ProcedureMetaSchema.safeParse(def.meta);
  if (!parsed.success) return null;
  return parsed.data.authz.privilege ?? null;
}
