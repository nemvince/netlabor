/** Fault injection: link impairment and console-driven device faults. */

import { AppError, type FaultRow, type LinkFilters, type TemplateFault } from '@netlabor/contract';
import { parseJsonColumn } from '@netlabor/db';
import { newId } from '@netlabor/shared';
import type { SQL } from 'bun';
import type { AppDeps } from '../implementer.ts';
import { getLink, listLinks, setFilters } from './links.ts';
import { getNode, listNodes } from './nodes.ts';

interface FaultRecord {
  id: string;
  project_id: string;
  kind: 'link' | 'device';
  target: Record<string, unknown> | string;
  params: Record<string, unknown> | string;
  state: 'active' | 'cleared' | 'error';
  recovery: Record<string, unknown> | string | null;
  created_at: Date;
  cleared_at: Date | null;
}

function toRow(record: FaultRecord): FaultRow {
  return {
    id: record.id,
    projectId: record.project_id,
    kind: record.kind,
    target: parseJsonColumn(record.target, {}),
    params: parseJsonColumn(record.params, {}),
    state: record.state,
    recovery: record.recovery === null ? null : parseJsonColumn(record.recovery, {}),
    createdAt: record.created_at.toISOString(),
    clearedAt: record.cleared_at?.toISOString() ?? null,
  };
}

export async function listFaults(deps: AppDeps, projectId: string): Promise<FaultRow[]> {
  const rows = await deps.db.unsafe<FaultRecord[]>(
    'SELECT * FROM faults WHERE project_id = $1 ORDER BY created_at DESC',
    [projectId],
  );
  return rows.map(toRow);
}

interface DeviceFaultDefinition extends TemplateFault {
  nodeId: string;
  nodeName: string;
}

async function deviceFaults(deps: AppDeps, projectId: string): Promise<DeviceFaultDefinition[]> {
  const nodes = await listNodes(deps.db, projectId);
  const definitions: DeviceFaultDefinition[] = [];
  for (const node of nodes) {
    if (!node.templateId) continue;
    const rows = await deps.db.unsafe<{ faults: unknown }[]>(
      'SELECT faults FROM templates WHERE id = $1',
      [node.templateId],
    );
    const faults = parseJsonColumn<TemplateFault[]>(rows[0]?.faults, []);
    for (const fault of faults) {
      definitions.push({ ...fault, nodeId: node.id, nodeName: node.name });
    }
  }
  return definitions;
}

const LINK_FAULTS: { id: string; label: string; filters: LinkFilters }[] = [
  { id: 'link_delay_100ms', label: 'Add 100 ms latency', filters: { delayMs: 100, jitterMs: 10 } },
  { id: 'link_delay_500ms', label: 'Add 500 ms latency', filters: { delayMs: 500, jitterMs: 20 } },
  { id: 'link_loss_10', label: 'Drop 10% of packets', filters: { lossPct: 10 } },
  { id: 'link_loss_50', label: 'Drop 50% of packets', filters: { lossPct: 50 } },
  { id: 'link_corrupt_5', label: 'Corrupt 5% of packets', filters: { corruptPct: 5 } },
];

export interface FaultCandidate {
  id: string;
  label: string;
  kind: 'link' | 'device';
  params: Record<string, unknown>;
  target: Record<string, unknown>;
  commands: string[];
  recovery: string[];
  prompt?: string;
}

/** Faults applicable to the current project state. */
export async function faultCatalog(deps: AppDeps, projectId: string): Promise<FaultCandidate[]> {
  const candidates: FaultCandidate[] = [];
  const links = await listLinks(deps.db, projectId);
  const activeLinks = links.filter((link) => link.status === 'active');
  for (const link of activeLinks) {
    for (const fault of LINK_FAULTS) {
      candidates.push({
        id: fault.id,
        label: fault.label,
        kind: 'link',
        params: { filters: fault.filters },
        target: { linkId: link.id, linkName: `${link.nodeAName} ↔ ${link.nodeBName}` },
        commands: [],
        recovery: [],
      });
    }
  }
  const devices = await deviceFaults(deps, projectId);
  for (const definition of devices) {
    candidates.push({
      id: definition.id,
      label: definition.label,
      kind: 'device',
      params: { params: definition.params, requires: definition.requires },
      target: { nodeId: definition.nodeId, nodeName: definition.nodeName },
      commands: definition.commands,
      recovery: definition.recovery,
      ...(definition.prompt ? { prompt: definition.prompt } : {}),
    });
  }
  return candidates;
}

function substitute(command: string, params: Record<string, string>): string {
  return command.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => params[key] ?? `{{${key}}}`);
}

export async function injectFaults(
  deps: AppDeps,
  userId: string,
  input: {
    projectId: string;
    count: number | 'random';
    target?: { kind?: 'link' | 'device'; linkIds?: string[]; nodeIds?: string[] };
    faultIds?: string[];
  },
): Promise<FaultRow[]> {
  let candidates = await faultCatalog(deps, input.projectId);
  if (input.faultIds && input.faultIds.length > 0) {
    candidates = candidates.filter((candidate) => input.faultIds?.includes(candidate.id));
  }
  if (input.target?.kind === 'device') {
    candidates = candidates.filter((candidate) => candidate.kind === 'device');
  }
  if (input.target?.kind === 'link') {
    candidates = candidates.filter((candidate) => candidate.kind === 'link');
  }
  if (input.target?.linkIds && input.target.linkIds.length > 0) {
    const allow = new Set(input.target.linkIds);
    candidates = candidates.filter(
      (candidate) => candidate.kind === 'device' || allow.has(String(candidate.target.linkId)),
    );
  }
  if (input.target?.nodeIds && input.target.nodeIds.length > 0) {
    const allow = new Set(input.target.nodeIds);
    candidates = candidates.filter(
      (candidate) => candidate.kind === 'link' || allow.has(String(candidate.target.nodeId)),
    );
  }
  if (candidates.length === 0) {
    throw new AppError('BAD_REQUEST', 'no applicable fault for the current topology', {
      details: { hint: 'start nodes or activate links first' },
    });
  }

  const count =
    input.count === 'random'
      ? Math.min(1 + Math.floor(Math.random() * 3), candidates.length)
      : input.count;
  const chosen: FaultCandidate[] = [];
  const pool = [...candidates];
  while (chosen.length < count && pool.length > 0) {
    const index = Math.floor(Math.random() * pool.length);
    const [candidate] = pool.splice(index, 1);
    if (candidate) chosen.push(candidate);
  }

  const created: FaultRow[] = [];
  for (const candidate of chosen) {
    if (candidate.kind === 'link') {
      const linkId = String(candidate.target.linkId);
      const link = await getLink(deps.db, linkId);
      const filters = { ...link.filters, ...(candidate.params.filters as LinkFilters) };
      await setFilters(deps, userId, linkId, filters);
      const id = newId();
      const rows = await deps.db.unsafe<FaultRecord[]>(
        `INSERT INTO faults (id, project_id, kind, target, params, state, recovery)
         VALUES ($1,$2,'link',$3::jsonb,$4::jsonb,'active',$5::jsonb) RETURNING *`,
        [
          id,
          input.projectId,
          candidate.target,
          { filters: candidate.params.filters, label: candidate.label },
          { previousFilters: link.filters },
        ],
      );
      if (rows[0]) created.push(toRow(rows[0]));
      continue;
    }

    const nodeId = String(candidate.target.nodeId);
    const node = await getNode(deps.db, nodeId);
    const params = (candidate.params.params as string[]) ?? [];
    const values: Record<string, string> = {};
    for (const name of params) {
      if (name === 'interface') values[name] = selectInterface(node.properties);
      else values[name] = defaultParamValue(name);
    }
    const commands = candidate.commands.map((command) => substitute(command, values));
    const result = await deps.agents.call(node.computeId, (agent) =>
      agent.execConsole({
        projectId: input.projectId,
        nodeId,
        commands,
        timeoutMs: 15_000,
        terminalLengthZero: true,
        prompt: candidate.prompt ?? null,
      }),
    );
    const id = newId();
    const rows = await deps.db.unsafe<FaultRecord[]>(
      `INSERT INTO faults (id, project_id, kind, target, params, state, recovery)
       VALUES ($1,$2,'device',$3::jsonb,$4::jsonb,$5,$6::jsonb) RETURNING *`,
      [
        id,
        input.projectId,
        candidate.target,
        { faultId: candidate.id, label: candidate.label, values, commands },
        result.ok ? 'active' : 'error',
        JSON.stringify({
          commands: candidate.recovery.map((command) => substitute(command, values)),
          prompt: candidate.prompt ?? null,
          transcript: result.transcript,
        }),
      ],
    );
    if (rows[0]) created.push(toRow(rows[0]));
  }

  await deps.events.publish({
    type: 'fault.applied',
    projectId: input.projectId,
    userId,
    payload: {
      faults: created.map((fault) => ({
        id: fault.id,
        kind: fault.kind,
        label: fault.params.label,
      })),
    },
  });
  return created;
}

function selectInterface(properties: Record<string, unknown>): string {
  const portName = properties.firstPortName;
  if (typeof portName === 'string' && portName.length > 0) return `${portName}0`;
  return 'Ethernet0/0';
}

function defaultParamValue(name: string): string {
  switch (name) {
    case 'mtu':
      return '1400';
    case 'cost':
      return '1000';
    case 'neighbor':
      return '10.0.0.2';
    case 'prefix':
      return '10.99.0.0';
    case 'mask':
      return '255.255.0.0';
    case 'acl':
      return '100';
    default:
      return '1';
  }
}

export async function clearFaults(
  deps: AppDeps,
  userId: string,
  input: { projectId: string; faultIds?: string[] },
): Promise<FaultRow[]> {
  const rows = await deps.db.unsafe<FaultRecord[]>(
    `SELECT * FROM faults WHERE project_id = $1 AND state <> 'cleared'
       AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))`,
    [input.projectId, input.faultIds ?? null],
  );
  const cleared: FaultRow[] = [];
  for (const record of rows) {
    const fault = toRow(record);
    try {
      if (fault.kind === 'link') {
        const linkId = String(fault.target.linkId);
        const recovery = (fault.recovery ?? {}) as { previousFilters?: LinkFilters };
        await setFilters(deps, userId, linkId, recovery.previousFilters ?? {});
      } else {
        const recovery = (fault.recovery ?? {}) as {
          commands?: string[];
          prompt?: string | null;
        };
        const nodeId = String(fault.target.nodeId);
        const node = await getNode(deps.db, nodeId);
        const result = await deps.agents.call(node.computeId, (agent) =>
          agent.execConsole({
            projectId: input.projectId,
            nodeId,
            commands: recovery.commands ?? [],
            timeoutMs: 15_000,
            terminalLengthZero: true,
            prompt: recovery.prompt ?? null,
          }),
        );
        if (!result.ok) throw new AppError('AGENT_ERROR', 'recovery commands timed out');
      }
      await deps.db.unsafe(
        `UPDATE faults SET state = 'cleared', cleared_at = now() WHERE id = $1`,
        [fault.id],
      );
      cleared.push({ ...fault, state: 'cleared', clearedAt: new Date().toISOString() });
    } catch (error) {
      await deps.db.unsafe(`UPDATE faults SET state = 'error' WHERE id = $1`, [fault.id]);
      deps.logger.warn('fault recovery failed', {
        faultId: fault.id,
        err: error instanceof Error ? error.message : String(error),
      });
    }
  }
  await deps.events.publish({
    type: 'fault.cleared',
    projectId: input.projectId,
    userId,
    payload: { faultIds: cleared.map((fault) => fault.id) },
  });
  return cleared;
}

/** Link fault filters for tests and the UI preview. */
export const LINK_FAULT_CATALOG = LINK_FAULTS;

export function rowSql(_db: SQL): void {}
