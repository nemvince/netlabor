/** Port allocation per compute, one row per (compute, port). */

import { AppError } from '@netlabor/contract';
import type { SQL } from 'bun';

export type PortKind = 'console' | 'aux' | 'vnc' | 'marker' | 'link' | 'iou_app';

export const PORT_RANGES: Record<PortKind, { start: number; end: number }> = {
  console: { start: 20_000, end: 29_999 },
  aux: { start: 30_000, end: 34_999 },
  vnc: { start: 35_000, end: 39_999 },
  marker: { start: 40_000, end: 44_999 },
  link: { start: 50_000, end: 59_999 },
  iou_app: { start: 1, end: 1024 },
};

/**
 * Allocate the lowest free port in the kind's range for a compute.
 * `side` distinguishes the two ends of a link allocation.
 */
export async function allocatePort(
  db: SQL,
  computeId: string,
  kind: PortKind,
  ownerId: string,
  side: string | null = null,
): Promise<number> {
  const { start, end } = PORT_RANGES[kind];
  for (let attempt = 0; attempt < 5; attempt++) {
    const rows = await db.unsafe<{ port: number }[]>(
      'SELECT port FROM port_allocations WHERE compute_id = $1 AND port BETWEEN $2 AND $3 ORDER BY port',
      [computeId, start, end],
    );
    const used = new Set(rows.map((row) => row.port));
    let candidate: number | null = null;
    for (let port = start; port <= end; port++) {
      if (!used.has(port)) {
        candidate = port;
        break;
      }
    }
    if (candidate === null) {
      throw new AppError('CONFLICT', `no free ${kind} port on compute ${computeId}`);
    }
    const inserted = await db.unsafe<{ port: number }[]>(
      `INSERT INTO port_allocations (compute_id, port, kind, side, owner_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (compute_id, port) DO NOTHING
       RETURNING port`,
      [computeId, candidate, kind, side, ownerId],
    );
    if (inserted[0]) return inserted[0].port;
  }
  throw new AppError('CONFLICT', `could not allocate a ${kind} port on compute ${computeId}`);
}

export async function releasePort(db: SQL, computeId: string, port: number): Promise<void> {
  await db.unsafe('DELETE FROM port_allocations WHERE compute_id = $1 AND port = $2', [
    computeId,
    port,
  ]);
}

/** Release every allocation owned by a node, link, or project. */
export async function releaseOwnedPorts(db: SQL, ownerId: string): Promise<void> {
  await db.unsafe('DELETE FROM port_allocations WHERE owner_id = $1', [ownerId]);
}

export async function releaseNodePorts(db: SQL, computeId: string, nodeId: string): Promise<void> {
  await db.unsafe('DELETE FROM port_allocations WHERE compute_id = $1 AND owner_id = $2', [
    computeId,
    nodeId,
  ]);
}
