/** Projects: CRUD, open/close lifecycle, slots, files, and statistics. */

import {
  AppError,
  type ProjectListInput,
  type ProjectRow,
  type ProjectStats,
} from '@netlabor/contract';
import { parseJsonColumn } from '@netlabor/db';
import { netnsName, newId } from '@netlabor/shared';
import type { SQL } from 'bun';
import type { AuthInfo } from '../context.ts';
import type { AppDeps } from '../implementer.ts';
import { allocatePort } from './ports.ts';

interface ProjectRecord {
  id: string;
  name: string;
  description: string | null;
  status: 'closed' | 'opened';
  locked: boolean;
  owner_id: string;
  owner_name: string;
  pool_id: string | null;
  variables: Record<string, string> | null;
  scene: Record<string, unknown> | null;
  auto_open: boolean;
  auto_close: boolean;
  auto_start: boolean;
  created_at: Date;
  updated_at: Date;
  node_count: string;
  link_count: string;
}

const PROJECT_COLUMNS = `
  p.id, p.name, p.description, p.status, p.locked, p.owner_id, u.username AS owner_name,
  p.pool_id, p.variables, p.scene, p.auto_open, p.auto_close, p.auto_start,
  p.created_at, p.updated_at,
  (SELECT count(*) FROM nodes n WHERE n.project_id = p.id)::text AS node_count,
  (SELECT count(*) FROM links l WHERE l.project_id = p.id)::text AS link_count`;

function toProjectRow(record: ProjectRecord): ProjectRow {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    status: record.status,
    locked: record.locked,
    ownerId: record.owner_id,
    ownerName: record.owner_name,
    poolId: record.pool_id,
    variables: parseJsonColumn(record.variables, {}),
    scene: parseJsonColumn(record.scene, {}),
    autoOpen: record.auto_open,
    autoClose: record.auto_close,
    autoStart: record.auto_start,
    createdAt: record.created_at.toISOString(),
    updatedAt: record.updated_at.toISOString(),
    nodeCount: Number(record.node_count),
    linkCount: Number(record.link_count),
  };
}

/** Project ids the caller may read: owned, granted, or everything for auditor/admin. */
export async function visibleProjectIds(db: SQL, auth: AuthInfo): Promise<'all' | string[]> {
  if (auth.isAdmin) return 'all';
  if (auth.globalPrivileges.has('audit.read')) return 'all';
  const userId = auth.user?.id;
  if (!userId) return [];
  const rows = await db.unsafe<{ project_id: string }[]>(
    `SELECT p.id AS project_id FROM projects p WHERE p.owner_id = $1
     UNION
     SELECT gr.project_id FROM project_grants gr
      WHERE (gr.subject_type = 'user' AND gr.subject_id = $1)
         OR (gr.subject_type = 'group'
             AND gr.subject_id IN (SELECT group_id FROM group_members WHERE user_id = $1))`,
    [userId],
  );
  return rows.map((row) => row.project_id);
}

export async function listProjects(
  db: SQL,
  auth: AuthInfo,
  input: ProjectListInput,
): Promise<ProjectRow[]> {
  const visible = await visibleProjectIds(db, auth);
  if (visible !== 'all' && visible.length === 0) return [];
  const rows = await db.unsafe<ProjectRecord[]>(
    `SELECT ${PROJECT_COLUMNS}
       FROM projects p JOIN users u ON u.id = p.owner_id
      WHERE ($1::text IS NULL OR p.name ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR p.status = $2)
        AND ($3::boolean OR p.status = 'opened')
        AND ($4::uuid[] IS NULL OR p.id = ANY($4::uuid[]))
      ORDER BY p.updated_at DESC
      LIMIT $5 OFFSET $6`,
    [
      input.search ?? null,
      input.status ?? null,
      input.includeClosed,
      visible === 'all' ? null : visible,
      input.limit,
      input.offset,
    ],
  );
  return rows.map(toProjectRow);
}

export async function getProject(db: SQL, id: string): Promise<ProjectRow> {
  const rows = await db.unsafe<ProjectRecord[]>(
    `SELECT ${PROJECT_COLUMNS} FROM projects p JOIN users u ON u.id = p.owner_id WHERE p.id = $1`,
    [id],
  );
  const record = rows[0];
  if (!record) throw new AppError('NOT_FOUND', 'project not found');
  return toProjectRow(record);
}

export async function requireUnlocked(db: SQL, projectId: string): Promise<void> {
  const rows = await db.unsafe<{ locked: boolean }[]>('SELECT locked FROM projects WHERE id = $1', [
    projectId,
  ]);
  if (!rows[0]) throw new AppError('NOT_FOUND', 'project not found');
  if (rows[0].locked) throw new AppError('CONFLICT', 'project is locked');
}

export async function createProject(
  deps: AppDeps,
  userId: string,
  input: {
    name: string;
    description?: string | null;
    poolId?: string | null;
    variables: Record<string, string>;
    autoOpen: boolean;
    autoClose: boolean;
    autoStart: boolean;
  },
): Promise<ProjectRow> {
  const id = newId();
  await deps.db.unsafe(
    `INSERT INTO projects (id, name, description, owner_id, pool_id, variables, auto_open, auto_close, auto_start)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
    [
      id,
      input.name,
      input.description ?? null,
      userId,
      input.poolId ?? null,
      input.variables,
      input.autoOpen,
      input.autoClose,
      input.autoStart,
    ],
  );
  const project = await getProject(deps.db, id);
  await deps.events.publish({
    type: 'project.updated',
    projectId: id,
    userId,
    payload: { projectId: id, created: true, name: project.name },
  });
  return project;
}

export async function updateProject(
  deps: AppDeps,
  input: {
    id: string;
    name?: string;
    description?: string | null;
    ownerId?: string;
    poolId?: string | null;
    variables?: Record<string, string>;
    scene?: Record<string, unknown>;
    autoOpen?: boolean;
    autoClose?: boolean;
    autoStart?: boolean;
  },
): Promise<ProjectRow> {
  const existing = await getProject(deps.db, input.id);
  if (input.ownerId && input.ownerId !== existing.ownerId) {
    const owner = await deps.db.unsafe<{ id: string }[]>('SELECT id FROM users WHERE id = $1', [
      input.ownerId,
    ]);
    if (!owner[0]) throw new AppError('NOT_FOUND', 'new owner not found');
  }
  await deps.db.unsafe(
    `UPDATE projects SET
       name = COALESCE($2, name),
       description = CASE WHEN $3::boolean THEN $4 ELSE description END,
       owner_id = COALESCE($5::uuid, owner_id),
       pool_id = CASE WHEN $6::boolean THEN $7::uuid ELSE pool_id END,
       variables = COALESCE($8::jsonb, variables),
       scene = COALESCE($9::jsonb, scene),
       auto_open = COALESCE($10::boolean, auto_open),
       auto_close = COALESCE($11::boolean, auto_close),
       auto_start = COALESCE($12::boolean, auto_start),
       updated_at = now()
     WHERE id = $1`,
    [
      input.id,
      input.name ?? null,
      input.description !== undefined,
      input.description ?? null,
      input.ownerId ?? null,
      input.poolId !== undefined,
      input.poolId ?? null,
      input.variables ?? null,
      input.scene ?? null,
      input.autoOpen ?? null,
      input.autoClose ?? null,
      input.autoStart ?? null,
    ],
  );
  const project = await getProject(deps.db, input.id);
  await deps.events.publish({
    type: 'project.updated',
    projectId: input.id,
    payload: { projectId: input.id, name: project.name, locked: project.locked },
  });
  return project;
}

/** Lowest free project slot for a compute (1..254). */
async function allocateSlot(db: SQL, computeId: string): Promise<number> {
  const rows = await db.unsafe<{ slot: number }[]>(
    'SELECT slot FROM project_slots WHERE compute_id = $1 ORDER BY slot',
    [computeId],
  );
  const used = new Set(rows.map((row) => row.slot));
  for (let slot = 1; slot <= 254; slot++) {
    if (!used.has(slot)) return slot;
  }
  throw new AppError('CONFLICT', `no free project slot on compute ${computeId}`);
}

/** Ensure a project namespace exists on a compute, allocating a slot if needed. */
export async function ensureProjectSlot(
  deps: AppDeps,
  projectId: string,
  computeId: string,
): Promise<{ slot: number; netns: string; projectIp: string }> {
  const existing = await deps.db.unsafe<{ slot: number; netns: string; project_ip: string }[]>(
    'SELECT slot, netns, host(project_ip) AS project_ip FROM project_slots WHERE project_id = $1 AND compute_id = $2',
    [projectId, computeId],
  );
  const slotRow = existing[0];
  if (slotRow) {
    // The row exists; the agent may have restarted and lost the namespace, so
    // re-assert it (the agent reuses an existing namespace idempotently).
    const marker = await deps.db.unsafe<{ port: number }[]>(
      'SELECT port FROM port_allocations WHERE compute_id = $1 AND owner_id = $2 AND kind = $3',
      [computeId, projectId, 'marker'],
    );
    let markerPort = marker[0]?.port ?? null;
    if (markerPort === null) {
      markerPort = await allocatePort(deps.db, computeId, 'marker', projectId, 'project');
    }
    await deps.agents.call(computeId, (agent) =>
      agent.ensureProject({ projectId, slot: slotRow.slot, markerPort }),
    );
    return { slot: slotRow.slot, netns: slotRow.netns, projectIp: slotRow.project_ip };
  }

  const compute = await deps.db.unsafe<{ underlay_index: number; status: string; name: string }[]>(
    'SELECT underlay_index, status, name FROM computes WHERE id = $1',
    [computeId],
  );
  const record = compute[0];
  if (!record) throw new AppError('NOT_FOUND', 'compute not found');
  if (record.status !== 'online') {
    throw new AppError('AGENT_UNAVAILABLE', `compute ${record.name} is offline`, {
      retryable: true,
    });
  }

  const slot = await allocateSlot(deps.db, computeId);
  const markerPort = await allocatePort(deps.db, computeId, 'marker', projectId, 'project');
  try {
    await deps.agents.call(computeId, (agent) =>
      agent.ensureProject({ projectId, slot, markerPort }),
    );
  } catch (error) {
    await deps.db.unsafe('DELETE FROM port_allocations WHERE owner_id = $1 AND kind = $2', [
      projectId,
      'marker',
    ]);
    throw error;
  }
  const netns = netnsName(projectId);
  const projectIp = `10.99.${record.underlay_index}.${slot}`;
  await deps.db.unsafe(
    `INSERT INTO project_slots (project_id, compute_id, slot, netns, project_ip)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (project_id, compute_id) DO NOTHING`,
    [projectId, computeId, slot, netns, projectIp],
  );
  return { slot, netns, projectIp };
}

export async function openProject(deps: AppDeps, projectId: string): Promise<ProjectRow> {
  const project = await getProject(deps.db, projectId);
  if (project.status === 'opened') return project;

  const computes = await deps.db.unsafe<
    { id: string; name: string; status: string; underlay_index: number }[]
  >(
    `SELECT DISTINCT c.id, c.name, c.status, c.underlay_index
       FROM nodes n JOIN computes c ON c.id = n.compute_id
      WHERE n.project_id = $1`,
    [projectId],
  );

  const offline = computes.filter((compute) => compute.status !== 'online');
  if (offline.length > 0) {
    throw new AppError(
      'AGENT_UNAVAILABLE',
      `cannot open project: compute ${offline.map((compute) => compute.name).join(', ')} is offline`,
      { details: offline.map((compute) => compute.id), retryable: true },
    );
  }

  const opened: string[] = [];
  try {
    for (const compute of computes) {
      await ensureProjectSlot(deps, projectId, compute.id);
      opened.push(compute.id);
    }
  } catch (error) {
    for (const computeId of opened) {
      await deps.agents
        .call(computeId, (agent) => agent.removeProject({ projectId, deleteFiles: false }))
        .catch(() => undefined);
      await deps.db.unsafe('DELETE FROM project_slots WHERE project_id = $1 AND compute_id = $2', [
        projectId,
        computeId,
      ]);
      await deps.db.unsafe('DELETE FROM port_allocations WHERE owner_id = $1 AND kind = $2', [
        projectId,
        'marker',
      ]);
    }
    throw error;
  }

  const { ensureNodeConsoleAllocation } = await import('./nodes.ts');
  const projectNodes = await deps.db.unsafe<{ id: string }[]>(
    'SELECT id FROM nodes WHERE project_id = $1 AND console_port IS NOT NULL',
    [projectId],
  );
  for (const node of projectNodes) {
    await ensureNodeConsoleAllocation(deps, node.id).catch(() => undefined);
  }
  await deps.db.unsafe(`UPDATE projects SET status = 'opened', updated_at = now() WHERE id = $1`, [
    projectId,
  ]);
  await deps.events.publish({
    type: 'project.updated',
    projectId,
    payload: { projectId, status: 'opened' },
  });
  return getProject(deps.db, projectId);
}

/** Re-assert namespaces for every opened project (controller/agent restart). */
export async function reconcileOpenProjects(deps: AppDeps): Promise<void> {
  const projects = await deps.db.unsafe<{ id: string }[]>(
    `SELECT id FROM projects WHERE status = 'opened'`,
  );
  for (const project of projects) {
    const slots = await deps.db.unsafe<{ compute_id: string }[]>(
      'SELECT compute_id FROM project_slots WHERE project_id = $1',
      [project.id],
    );
    const computes =
      slots.length > 0
        ? slots.map((slot) => slot.compute_id)
        : (
            await deps.db.unsafe<{ compute_id: string }[]>(
              'SELECT DISTINCT compute_id FROM nodes WHERE project_id = $1',
              [project.id],
            )
          ).map((row) => row.compute_id);
    for (const computeId of computes) {
      try {
        await ensureProjectSlot(deps, project.id, computeId);
      } catch (error) {
        deps.logger.warn('project namespace re-assert failed', {
          projectId: project.id,
          computeId,
          err: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

export async function closeProject(deps: AppDeps, projectId: string): Promise<ProjectRow> {
  const project = await getProject(deps.db, projectId);
  if (project.status === 'closed') return project;

  const slots = await deps.db.unsafe<{ compute_id: string }[]>(
    'SELECT compute_id FROM project_slots WHERE project_id = $1',
    [projectId],
  );
  for (const slot of slots) {
    await deps.agents
      .call(slot.compute_id, (agent) => agent.removeProject({ projectId, deleteFiles: false }))
      .catch((error: unknown) => {
        deps.logger.warn('removeProject failed during close', {
          projectId,
          computeId: slot.compute_id,
          err: error instanceof Error ? error.message : String(error),
        });
      });
  }

  await deps.db.unsafe('DELETE FROM project_slots WHERE project_id = $1', [projectId]);
  await deps.db.unsafe(
    `DELETE FROM port_allocations
      WHERE owner_id = $1
         OR owner_id IN (SELECT id FROM nodes WHERE project_id = $1)
         OR owner_id IN (SELECT id FROM links WHERE project_id = $1)`,
    [projectId],
  );
  await deps.db.unsafe(
    `UPDATE nodes SET status = 'stopped', updated_at = now() WHERE project_id = $1`,
    [projectId],
  );
  await deps.db.unsafe(
    `UPDATE links SET status = 'pending', updated_at = now() WHERE project_id = $1`,
    [projectId],
  );
  await deps.db.unsafe(`UPDATE projects SET status = 'closed', updated_at = now() WHERE id = $1`, [
    projectId,
  ]);
  await deps.events.publish({
    type: 'project.updated',
    projectId,
    payload: { projectId, status: 'closed' },
  });
  return getProject(deps.db, projectId);
}

export async function setProjectLocked(
  deps: AppDeps,
  projectId: string,
  locked: boolean,
): Promise<ProjectRow> {
  await getProject(deps.db, projectId);
  await deps.db.unsafe('UPDATE projects SET locked = $2, updated_at = now() WHERE id = $1', [
    projectId,
    locked,
  ]);
  const project = await getProject(deps.db, projectId);
  await deps.events.publish({ type: 'project.updated', projectId, payload: { projectId, locked } });
  return project;
}

export async function deleteProject(deps: AppDeps, projectId: string): Promise<void> {
  const project = await getProject(deps.db, projectId);
  const slots = await deps.db.unsafe<{ compute_id: string }[]>(
    'SELECT compute_id FROM project_slots WHERE project_id = $1',
    [projectId],
  );
  const computeIds =
    slots.length > 0
      ? slots.map((slot) => slot.compute_id)
      : (
          await deps.db.unsafe<{ compute_id: string }[]>(
            'SELECT DISTINCT compute_id FROM nodes WHERE project_id = $1',
            [projectId],
          )
        ).map((row) => row.compute_id);

  await closeProject(deps, projectId).catch(() => undefined);
  for (const computeId of computeIds) {
    await deps.agents
      .call(computeId, (agent) => agent.removeProject({ projectId, deleteFiles: true }))
      .catch(() => undefined);
  }
  await deps.db.unsafe('DELETE FROM projects WHERE id = $1', [projectId]);
  await deps.events.publish({
    type: 'project.deleted',
    projectId,
    payload: { projectId, name: project.name },
  });
}

export async function projectStats(deps: AppDeps, projectId: string): Promise<ProjectStats> {
  const rows = await deps.db.unsafe<{ status: string; count: string }[]>(
    'SELECT status, count(*)::text AS count FROM nodes WHERE project_id = $1 GROUP BY status',
    [projectId],
  );
  const counts = await deps.db.unsafe<{ nodes: string; links: string; drawings: string }[]>(
    `SELECT (SELECT count(*) FROM nodes WHERE project_id = $1)::text AS nodes,
            (SELECT count(*) FROM links WHERE project_id = $1)::text AS links,
            (SELECT count(*) FROM drawings WHERE project_id = $1)::text AS drawings`,
    [projectId],
  );
  const slots = await deps.db.unsafe<
    { compute_id: string; slot: number; netns: string; project_ip: string }[]
  >(
    'SELECT compute_id, slot, netns, host(project_ip) AS project_ip FROM project_slots WHERE project_id = $1',
    [projectId],
  );
  return {
    nodeCount: Number(counts[0]?.nodes ?? 0),
    linkCount: Number(counts[0]?.links ?? 0),
    drawingCount: Number(counts[0]?.drawings ?? 0),
    nodesByStatus: Object.fromEntries(rows.map((row) => [row.status, Number(row.count)])),
    slots: slots.map((slot) => ({
      computeId: slot.compute_id,
      slot: slot.slot,
      netns: slot.netns,
      projectIp: slot.project_ip,
      ubridgeSocket: null,
    })),
  };
}
