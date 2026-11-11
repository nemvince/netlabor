/** Compute servers and pools: registration, tokens, status, and statistics. */

import {
  type AgentCapabilities,
  AppError,
  type ComputeRow,
  type ComputeStats,
  type PoolRow,
} from '@netlabor/contract';
import { parseJsonColumn } from '@netlabor/db';
import { encryptSecret, newId, randomToken, sha256Hex } from '@netlabor/shared';
import type { SQL } from 'bun';
import type { AppDeps } from '../implementer.ts';

interface ComputeRecord {
  id: string;
  name: string;
  url: string;
  underlay_index: number;
  underlay_host: string;
  status: 'online' | 'offline' | 'error';
  version: string | null;
  capabilities: AgentCapabilities | null;
  last_seen_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function toComputeRow(record: ComputeRecord, pools: { id: string; name: string }[]): ComputeRow {
  return {
    id: record.id,
    name: record.name,
    url: record.url,
    underlayIndex: record.underlay_index,
    underlayHost: record.underlay_host,
    status: record.status,
    version: record.version,
    capabilities: record.capabilities === null ? null : parseJsonColumn(record.capabilities, null),
    lastSeenAt: record.last_seen_at?.toISOString() ?? null,
    createdAt: record.created_at.toISOString(),
    updatedAt: record.updated_at.toISOString(),
    pools,
  };
}

async function poolsFor(
  db: SQL,
  computeIds: string[],
): Promise<Map<string, { id: string; name: string }[]>> {
  const map = new Map<string, { id: string; name: string }[]>();
  if (computeIds.length === 0) return map;
  const rows = await db.unsafe<{ compute_id: string; id: string; name: string }[]>(
    `SELECT pc.compute_id, p.id, p.name
       FROM pool_computes pc JOIN pools p ON p.id = pc.pool_id
      WHERE pc.compute_id = ANY($1::uuid[])`,
    [computeIds],
  );
  for (const row of rows) {
    const list = map.get(row.compute_id) ?? [];
    list.push({ id: row.id, name: row.name });
    map.set(row.compute_id, list);
  }
  return map;
}

export async function listComputes(db: SQL): Promise<ComputeRow[]> {
  const records = await db.unsafe<ComputeRecord[]>(
    `SELECT id, name, url, underlay_index, underlay_host, status, version, capabilities, last_seen_at, created_at, updated_at
       FROM computes ORDER BY name ASC`,
  );
  const pools = await poolsFor(
    db,
    records.map((record) => record.id),
  );
  return records.map((record) => toComputeRow(record, pools.get(record.id) ?? []));
}

export async function getCompute(db: SQL, id: string): Promise<ComputeRow> {
  const rows = await db.unsafe<ComputeRecord[]>(
    `SELECT id, name, url, underlay_index, underlay_host, status, version, capabilities, last_seen_at, created_at, updated_at
       FROM computes WHERE id = $1`,
    [id],
  );
  const record = rows[0];
  if (!record) throw new AppError('NOT_FOUND', 'compute not found');
  const pools = await poolsFor(db, [record.id]);
  return toComputeRow(record, pools.get(record.id) ?? []);
}

async function allocateUnderlayIndex(db: SQL): Promise<number> {
  const rows = await db.unsafe<{ underlay_index: number }[]>(
    'SELECT underlay_index FROM computes ORDER BY 1',
  );
  const used = new Set(rows.map((row) => row.underlay_index));
  for (let index = 1; index <= 254; index++) {
    if (!used.has(index)) return index;
  }
  throw new AppError('CONFLICT', 'no free underlay index (1..254)');
}

async function storeToken(deps: AppDeps, computeId: string, token: string): Promise<string> {
  const secret = encryptSecret(token, deps.config.secretKey);
  const name = `compute-token:${computeId}`;
  const existing = await deps.db.unsafe<{ id: string }[]>(
    'SELECT id FROM secrets WHERE name = $1',
    [name],
  );
  if (existing[0]) {
    await deps.db.unsafe('UPDATE secrets SET ciphertext = $2, nonce = $3 WHERE id = $1', [
      existing[0].id,
      secret.ciphertext,
      secret.nonce,
    ]);
  } else {
    await deps.db.unsafe(
      'INSERT INTO secrets (id, name, ciphertext, nonce) VALUES ($1, $2, $3, $4)',
      [newId(), name, secret.ciphertext, secret.nonce],
    );
  }
  return sha256Hex(token);
}

export async function createCompute(
  deps: AppDeps,
  input: { name: string; url: string; underlayHost: string; poolIds: string[] },
): Promise<{ compute: ComputeRow; token: string }> {
  const { db, config } = deps;
  if (!config.allowInsecureAgent && !input.url.startsWith('https://')) {
    throw new AppError(
      'BAD_REQUEST',
      'compute URL must use https:// (set NB_ALLOW_INSECURE_AGENT=1 for plain HTTP)',
    );
  }
  const existing = await db.unsafe<{ id: string }[]>('SELECT id FROM computes WHERE name = $1', [
    input.name,
  ]);
  if (existing[0]) throw new AppError('CONFLICT', 'compute name already exists');

  const id = newId();
  const token = randomToken(32);
  const underlayIndex = await allocateUnderlayIndex(db);
  const tokenHash = await storeToken(deps, id, token);

  await db.unsafe(
    `INSERT INTO computes (id, name, url, token_hash, underlay_index, underlay_host, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'offline')`,
    [id, input.name, input.url.replace(/\/$/, ''), tokenHash, underlayIndex, input.underlayHost],
  );
  await setComputePools(db, id, input.poolIds);
  return { compute: await getCompute(db, id), token };
}

export async function updateCompute(
  deps: AppDeps,
  input: { id: string; name?: string; url?: string; underlayHost?: string; poolIds?: string[] },
): Promise<ComputeRow> {
  const { db, config } = deps;
  if (input.url && !config.allowInsecureAgent && !input.url.startsWith('https://')) {
    throw new AppError(
      'BAD_REQUEST',
      'compute URL must use https:// (set NB_ALLOW_INSECURE_AGENT=1 for plain HTTP)',
    );
  }
  const existing = await getCompute(db, input.id);
  const name = input.name ?? existing.name;
  const url = (input.url ?? existing.url).replace(/\/$/, '');
  const underlayHost = input.underlayHost ?? existing.underlayHost;
  const duplicate = await db.unsafe<{ id: string }[]>(
    'SELECT id FROM computes WHERE name = $1 AND id <> $2',
    [name, input.id],
  );
  if (duplicate[0]) throw new AppError('CONFLICT', 'compute name already exists');
  await db.unsafe(
    'UPDATE computes SET name = $2, url = $3, underlay_host = $4, updated_at = now() WHERE id = $1',
    [input.id, name, url, underlayHost],
  );
  if (input.poolIds) await setComputePools(db, input.id, input.poolIds);
  deps.agents.invalidate(input.id);
  return getCompute(db, input.id);
}

export async function deleteCompute(deps: AppDeps, id: string): Promise<void> {
  const { db } = deps;
  const nodes = await db.unsafe<{ id: string }[]>(
    'SELECT id FROM nodes WHERE compute_id = $1 LIMIT 1',
    [id],
  );
  if (nodes[0])
    throw new AppError('CONFLICT', 'compute still hosts nodes; move or delete them first');
  await db.unsafe('DELETE FROM secrets WHERE name = $1', [`compute-token:${id}`]);
  const rows = await db.unsafe<{ id: string }[]>(
    'DELETE FROM computes WHERE id = $1 RETURNING id',
    [id],
  );
  if (!rows[0]) throw new AppError('NOT_FOUND', 'compute not found');
  deps.agents.invalidate(id);
}

export async function rotateToken(deps: AppDeps, id: string): Promise<string> {
  const { db } = deps;
  await getCompute(db, id);
  const token = randomToken(32);
  const hash = await storeToken(deps, id, token);
  await db.unsafe('UPDATE computes SET token_hash = $2, updated_at = now() WHERE id = $1', [
    id,
    hash,
  ]);
  deps.agents.invalidate(id);
  return token;
}

export async function setComputeStatus(
  db: SQL,
  id: string,
  status: 'online' | 'offline' | 'error',
  extra: { version?: string | null; capabilities?: AgentCapabilities | null } = {},
): Promise<void> {
  await db.unsafe(
    `UPDATE computes SET status = $2,
            version = COALESCE($3, version),
            capabilities = COALESCE($4::jsonb, capabilities),
            last_seen_at = CASE WHEN $2 = 'online' THEN now() ELSE last_seen_at END,
            updated_at = now()
      WHERE id = $1`,
    [id, status, extra.version ?? null, extra.capabilities ?? null],
  );
}

export async function computeStats(deps: AppDeps, id: string): Promise<ComputeStats> {
  const compute = await getCompute(deps.db, id);
  const stats = await deps.agents.call(id, (agent) => agent.stats({}));
  return { ...stats, computeId: compute.id };
}

async function setComputePools(db: SQL, computeId: string, poolIds: string[]): Promise<void> {
  await db.unsafe('DELETE FROM pool_computes WHERE compute_id = $1', [computeId]);
  for (const poolId of poolIds) {
    await db.unsafe(
      'INSERT INTO pool_computes (pool_id, compute_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [poolId, computeId],
    );
  }
}

/* ------------------------------------------------------------------ pools --- */

export async function listPools(db: SQL): Promise<PoolRow[]> {
  const rows = await db.unsafe<
    { id: string; name: string; description: string | null; compute_ids: string[] | null }[]
  >(
    `SELECT p.id, p.name, p.description,
            COALESCE(array_agg(pc.compute_id::text) FILTER (WHERE pc.compute_id IS NOT NULL), '{}') AS compute_ids
       FROM pools p LEFT JOIN pool_computes pc ON pc.pool_id = p.id
      GROUP BY p.id ORDER BY p.name ASC`,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    computeIds: row.compute_ids ?? [],
  }));
}

export async function upsertPool(
  db: SQL,
  input: { id?: string; name: string; description?: string | null; computeIds: string[] },
): Promise<PoolRow> {
  const id = input.id ?? newId();
  const duplicate = await db.unsafe<{ id: string }[]>(
    'SELECT id FROM pools WHERE name = $1 AND id <> $2',
    [input.name, id],
  );
  if (duplicate[0]) throw new AppError('CONFLICT', 'pool name already exists');
  if (input.id) {
    const rows = await db.unsafe<{ id: string }[]>(
      'UPDATE pools SET name = $2, description = $3 WHERE id = $1 RETURNING id',
      [id, input.name, input.description ?? null],
    );
    if (!rows[0]) throw new AppError('NOT_FOUND', 'pool not found');
  } else {
    await db.unsafe('INSERT INTO pools (id, name, description) VALUES ($1, $2, $3)', [
      id,
      input.name,
      input.description ?? null,
    ]);
  }
  await db.unsafe('DELETE FROM pool_computes WHERE pool_id = $1', [id]);
  for (const computeId of input.computeIds) {
    await db.unsafe(
      'INSERT INTO pool_computes (pool_id, compute_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [id, computeId],
    );
  }
  const pools = await listPools(db);
  const pool = pools.find((entry) => entry.id === id);
  if (!pool) throw new AppError('INTERNAL', 'pool missing after upsert');
  return pool;
}

export async function deletePool(db: SQL, id: string): Promise<void> {
  const rows = await db.unsafe<{ id: string }[]>('DELETE FROM pools WHERE id = $1 RETURNING id', [
    id,
  ]);
  if (!rows[0]) throw new AppError('NOT_FOUND', 'pool not found');
}

/** Agent environment block used by install scripts and the compute dialog. */
export function agentEnvironment(deps: AppDeps, compute: ComputeRow, token: string): string {
  return [
    'NB_AGENT_LISTEN=0.0.0.0:8081',
    `NB_AGENT_TOKEN=${token}`,
    `NB_UNDERLAY_INDEX=${compute.underlayIndex}`,
    `NB_UNDERLAY_HOST=${compute.underlayHost}`,
    'NB_STATE_DIR=/var/lib/netlabor',
    'NB_RUN_DIR=/run/netlabor',
    `NB_LOG_LEVEL=${deps.config.logLevel}`,
  ].join('\n');
}
