/** Links: dataplane planning, filters, capture, and markers. */

import { anchorNames, linkBridgeName } from '@netlabor/catalog/anchors';
import {
  type AgentLinkSpec,
  AppError,
  type CaptureState,
  type LinkDataplane,
  type LinkFilters,
  type LinkRow,
  type LinkStyle,
  type MarkerRow,
  type NodeRow,
} from '@netlabor/contract';
import { parseJsonColumn } from '@netlabor/db';
import { newId } from '@netlabor/shared';
import type { SQL } from 'bun';
import type { AppDeps } from '../implementer.ts';
import { getNode, nodePortOrThrow } from './nodes.ts';
import { allocatePort, releaseOwnedPorts } from './ports.ts';
import { requireUnlocked } from './projects.ts';

interface LinkRecord {
  id: string;
  project_id: string;
  link_type: 'ethernet' | 'serial' | 'atm' | 'frame_relay';
  node_a_id: string;
  adapter_a: number;
  port_a: number;
  node_b_id: string;
  adapter_b: number;
  port_b: number;
  suspend: boolean;
  status: 'pending' | 'active' | 'suspended' | 'error';
  style: LinkStyle | string | null;
  filters: LinkFilters | string | null;
  capture: CaptureState | string | null;
  dataplane: LinkDataplane | string | null;
  created_at: Date;
  updated_at: Date;
  node_a_name: string;
  node_b_name: string;
}

const LINK_COLUMNS = `
  l.id, l.project_id, l.link_type, l.node_a_id, l.adapter_a, l.port_a, l.node_b_id, l.adapter_b, l.port_b,
  l.suspend, l.status, l.style, l.filters, l.capture, l.dataplane, l.created_at, l.updated_at,
  a.name AS node_a_name, b.name AS node_b_name`;

function toLinkRow(record: LinkRecord): LinkRow {
  const capture = record.capture === null ? null : parseJsonColumn(record.capture, null);
  const dataplane = record.dataplane === null ? null : parseJsonColumn(record.dataplane, null);
  return {
    id: record.id,
    projectId: record.project_id,
    linkType: record.link_type,
    nodeAId: record.node_a_id,
    nodeAName: record.node_a_name,
    adapterA: record.adapter_a,
    portA: record.port_a,
    nodeBId: record.node_b_id,
    nodeBName: record.node_b_name,
    adapterB: record.adapter_b,
    portB: record.port_b,
    suspend: record.suspend,
    status: record.status,
    style: parseJsonColumn(record.style, { type: 'straight' as const }),
    filters: parseJsonColumn(record.filters, {}),
    capture: capture as CaptureState | null,
    dataplane: dataplane as LinkDataplane | null,
    createdAt: record.created_at.toISOString(),
    updatedAt: record.updated_at.toISOString(),
  };
}

export async function listLinks(db: SQL, projectId: string): Promise<LinkRow[]> {
  const rows = await db.unsafe<LinkRecord[]>(
    `SELECT ${LINK_COLUMNS} FROM links l
       JOIN nodes a ON a.id = l.node_a_id
       JOIN nodes b ON b.id = l.node_b_id
      WHERE l.project_id = $1 ORDER BY l.created_at ASC`,
    [projectId],
  );
  return rows.map(toLinkRow);
}

export async function getLink(db: SQL, id: string): Promise<LinkRow> {
  const rows = await db.unsafe<LinkRecord[]>(
    `SELECT ${LINK_COLUMNS} FROM links l
       JOIN nodes a ON a.id = l.node_a_id
       JOIN nodes b ON b.id = l.node_b_id
      WHERE l.id = $1`,
    [id],
  );
  const record = rows[0];
  if (!record) throw new AppError('NOT_FOUND', 'link not found');
  return toLinkRow(record);
}

type AnchorKind = 'tap' | 'veth' | 'udp';

function anchorKindFor(node: NodeRow): AnchorKind {
  switch (node.nodeType) {
    case 'qemu':
    case 'iou':
      return 'tap';
    case 'docker':
    case 'ethernet_switch':
    case 'ethernet_hub':
    case 'cloud':
    case 'nat':
      return 'veth';
    default:
      return 'udp';
  }
}

interface EndpointPlan {
  node: NodeRow;
  anchor: { kind: AnchorKind; name: string | null; mac?: string | null };
  udp: { lport: number; rhost: string; rport: number } | null;
  emulatorUdp: { localPort: number; remotePort: number; remoteHost: string } | null;
}

async function projectIpFor(deps: AppDeps, projectId: string, computeId: string): Promise<string> {
  const rows = await deps.db.unsafe<{ project_ip: string }[]>(
    'SELECT host(project_ip) AS project_ip FROM project_slots WHERE project_id = $1 AND compute_id = $2',
    [projectId, computeId],
  );
  const ip = rows[0]?.project_ip;
  if (!ip) throw new AppError('NODE_NOT_RUNNING', 'project is not open on the node compute');
  return ip;
}

/** Plan anchors and UDP allocations for both endpoints. */
async function planEndpoints(
  deps: AppDeps,
  link: LinkRow,
  crossCompute: boolean,
): Promise<{ endpoints: EndpointPlan[]; peerPorts: number[] }> {
  const nodeA = await getNode(deps.db, link.nodeAId);
  const nodeB = await getNode(deps.db, link.nodeBId);
  const projectIpA = await projectIpFor(deps, link.projectId, nodeA.computeId);
  const projectIpB = await projectIpFor(deps, link.projectId, nodeB.computeId);
  const peerPorts: number[] = [];

  const plan = async (
    node: NodeRow,
    adapter: number,
    port: number,
    projectIp: string,
  ): Promise<EndpointPlan> => {
    nodePortOrThrow(node, adapter, port);
    const names = anchorNames(node.nodeType, node.id, adapter, port);
    const kind = anchorKindFor(node);
    // Every cross-compute link needs one UDP NIO per side regardless of the
    // local anchor kind: the relay bridges on the two computes talk to each
    // other over this allocated port pair.
    if (crossCompute) {
      peerPorts.push(
        await allocatePort(deps.db, node.computeId, 'link', link.id, `peer-${node.id}`),
      );
    }
    if (kind === 'udp') {
      const nodePort = await allocatePort(
        deps.db,
        node.computeId,
        'link',
        link.id,
        `node-${node.id}`,
      );
      const bridgePort = await allocatePort(
        deps.db,
        node.computeId,
        'link',
        link.id,
        `bridge-${node.id}`,
      );
      return {
        node,
        anchor: { kind: 'udp', name: null },
        udp: { lport: bridgePort, rhost: projectIp, rport: nodePort },
        emulatorUdp: { localPort: nodePort, remotePort: bridgePort, remoteHost: projectIp },
      };
    }
    return {
      node,
      anchor: { kind, name: names.interfaceName ?? names.tapName },
      udp: null,
      emulatorUdp: null,
    };
  };

  const endpointA = await plan(nodeA, link.adapterA, link.portA, projectIpA);
  const endpointB = await plan(nodeB, link.adapterB, link.portB, projectIpB);
  return { endpoints: [endpointA, endpointB], peerPorts };
}

function buildSpec(
  link: LinkRow,
  endpoints: EndpointPlan[],
  mode: 'kernel' | 'relay',
  peer: { computeId: string; projectIp: string; port: number; localPort: number } | null,
  markers: {
    id: string;
    name: string;
    bpf: string;
    tag: number;
    direction: 'tx' | 'rx' | null;
    pcapPath: string;
  }[],
): AgentLinkSpec {
  return {
    linkId: link.id,
    projectId: link.projectId,
    mode,
    captureNodeId: link.nodeAId,
    filterSide: link.nodeAId,
    laneType: link.linkType,
    endpoints: endpoints.map((endpoint) => ({
      computeId: endpoint.node.computeId,
      nodeId: endpoint.node.id,
      nodeType: endpoint.node.nodeType,
      anchor: endpoint.anchor,
      udp: endpoint.udp,
      emulatorUdp: endpoint.emulatorUdp,
    })),
    peer,
    filters: link.filters as Record<string, unknown>,
    markers,
  };
}

async function markerSpecs(
  deps: AppDeps,
  linkId: string,
): Promise<
  {
    id: string;
    name: string;
    bpf: string;
    tag: number;
    direction: 'tx' | 'rx' | null;
    pcapPath: string;
  }[]
> {
  const rows = await deps.db.unsafe<
    {
      id: string;
      name: string;
      bpf: string;
      tag: number;
      direction: 'tx' | 'rx' | null;
      enabled: boolean;
      paused: boolean;
    }[]
  >('SELECT id, name, bpf, tag, direction, enabled, paused FROM markers WHERE link_id = $1', [
    linkId,
  ]);
  return rows
    .filter((row) => row.enabled && !row.paused)
    .map((row) => ({
      id: row.id,
      name: row.name,
      bpf: row.bpf,
      tag: row.tag,
      direction: row.direction,
      pcapPath: '',
    }));
}

/** Create the dataplane on both computes; leaves the row `active`. */
export async function ensureLinkDataplane(deps: AppDeps, linkId: string): Promise<LinkRow> {
  const link = await getLink(deps.db, linkId);
  const nodeA = await getNode(deps.db, link.nodeAId);
  const nodeB = await getNode(deps.db, link.nodeBId);
  if (nodeA.status !== 'started' || nodeB.status !== 'started') return link;
  if (nodeA.isolated || nodeB.isolated) return link;

  const crossCompute = nodeA.computeId !== nodeB.computeId;
  const kindA = anchorKindFor(nodeA);
  const kindB = anchorKindFor(nodeB);
  const mode: 'kernel' | 'relay' =
    !crossCompute && kindA !== 'udp' && kindB !== 'udp' ? 'kernel' : 'relay';

  // Every ensure starts from a clean port set so stop/start cycles cannot leak
  // allocations. The dataplane (if any) is deleted before this runs.
  await releaseOwnedPorts(deps.db, link.id);
  const { endpoints, peerPorts } = await planEndpoints(deps, link, crossCompute);
  const markers = await markerSpecs(deps, link.id);
  const projectIpA = await projectIpFor(deps, link.projectId, nodeA.computeId);
  const projectIpB = await projectIpFor(deps, link.projectId, nodeB.computeId);

  // An agent only builds the endpoints that live on its own compute. In
  // cross-compute relay mode each side adds exactly one local NIO plus the
  // peer NIO; sending it the remote endpoint as well would exceed ubridge's
  // two NIOs per bridge.
  const localEndpoints = (computeId: string): EndpointPlan[] =>
    crossCompute
      ? endpoints.filter((endpoint) => endpoint.node.computeId === computeId)
      : endpoints;
  const peerFor = (
    remoteComputeId: string,
    remoteIp: string,
    remotePort: number,
    localPort: number,
  ) =>
    crossCompute
      ? { computeId: remoteComputeId, projectIp: remoteIp, port: remotePort, localPort }
      : null;

  const specA = buildSpec(
    link,
    localEndpoints(nodeA.computeId),
    mode,
    peerFor(nodeB.computeId, projectIpB, peerPorts[1] ?? 0, peerPorts[0] ?? 0),
    markers,
  );
  const specB = buildSpec(
    link,
    localEndpoints(nodeB.computeId),
    mode,
    peerFor(nodeA.computeId, projectIpA, peerPorts[0] ?? 0, peerPorts[1] ?? 0),
    markers,
  );

  const dataplane: LinkDataplane = {
    mode,
    captureNodeId: nodeA.id,
    filterSide: nodeA.id,
    endpoints: endpoints.map((endpoint) => ({
      computeId: endpoint.node.computeId,
      anchor: endpoint.anchor.name ?? 'udp',
      lport: endpoint.udp?.lport ?? null,
      anchorKind: endpoint.anchor.kind,
    })),
    peer: crossCompute
      ? { computeId: nodeB.computeId, ip: projectIpB, port: peerPorts[1] ?? 0 }
      : null,
  };

  await deps.db.unsafe(`UPDATE links SET status = 'pending', dataplane = $2::jsonb WHERE id = $1`, [
    link.id,
    dataplane,
  ]);

  const createdOn: string[] = [];
  try {
    await deps.agents.call(nodeA.computeId, (agent) => agent.createLink(specA));
    createdOn.push(nodeA.computeId);
    if (crossCompute) {
      await deps.agents.call(nodeB.computeId, (agent) => agent.createLink(specB));
      createdOn.push(nodeB.computeId);
    }
  } catch (error) {
    for (const computeId of createdOn) {
      await deps.agents
        .call(computeId, (agent) =>
          agent.deleteLink({ projectId: link.projectId, linkId: link.id }),
        )
        .catch(() => undefined);
    }
    await releaseOwnedPorts(deps.db, link.id);
    await deps.db.unsafe(`UPDATE links SET status = 'pending', dataplane = NULL WHERE id = $1`, [
      link.id,
    ]);
    throw error instanceof AppError
      ? error
      : new AppError('AGENT_ERROR', 'link dataplane creation failed');
  }

  await deps.db.unsafe(
    `UPDATE links SET status = 'active', suspend = false, updated_at = now() WHERE id = $1`,
    [link.id],
  );
  await deps.events.publish({
    type: 'link.status',
    projectId: link.projectId,
    payload: { linkId: link.id, status: 'active', mode },
  });
  return getLink(deps.db, link.id);
}

export async function createLink(
  deps: AppDeps,
  userId: string,
  input: {
    projectId: string;
    nodeAId: string;
    adapterA: number;
    portA: number;
    nodeBId: string;
    adapterB: number;
    portB: number;
    style?: Partial<LinkStyle>;
  },
): Promise<LinkRow> {
  await requireUnlocked(deps.db, input.projectId);
  if (
    input.nodeAId === input.nodeBId &&
    input.adapterA === input.adapterB &&
    input.portA === input.portB
  ) {
    throw new AppError('BAD_REQUEST', 'a link needs two different ports');
  }
  const nodeA = await getNode(deps.db, input.nodeAId);
  const nodeB = await getNode(deps.db, input.nodeBId);
  if (nodeA.projectId !== input.projectId || nodeB.projectId !== input.projectId) {
    throw new AppError('BAD_REQUEST', 'both nodes must belong to the project');
  }
  const portA = nodePortOrThrow(nodeA, input.adapterA, input.portA);
  const portB = nodePortOrThrow(nodeB, input.adapterB, input.portB);
  if (portA.type !== portB.type) {
    throw new AppError('BAD_REQUEST', `cannot link ${portA.type} to ${portB.type}`);
  }
  const duplicate = await deps.db.unsafe<{ id: string }[]>(
    `SELECT id FROM links WHERE project_id = $1 AND
       ((node_a_id = $2 AND adapter_a = $3 AND port_a = $4 AND node_b_id = $5 AND adapter_b = $6 AND port_b = $7)
     OR (node_a_id = $5 AND adapter_a = $6 AND port_a = $7 AND node_b_id = $2 AND adapter_b = $3 AND port_b = $4))`,
    [
      input.projectId,
      input.nodeAId,
      input.adapterA,
      input.portA,
      input.nodeBId,
      input.adapterB,
      input.portB,
    ],
  );
  if (duplicate[0]) throw new AppError('CONFLICT', 'these ports are already linked');
  const endpointUsed = await deps.db.unsafe<{ id: string }[]>(
    `SELECT id FROM links WHERE project_id = $1 AND (
       (node_a_id = $2 AND adapter_a = $3 AND port_a = $4) OR
       (node_b_id = $2 AND adapter_b = $3 AND port_b = $4) OR
       (node_a_id = $5 AND adapter_a = $6 AND port_a = $7) OR
       (node_b_id = $5 AND adapter_b = $6 AND port_b = $7)
     )`,
    [
      input.projectId,
      input.nodeAId,
      input.adapterA,
      input.portA,
      input.nodeBId,
      input.adapterB,
      input.portB,
    ],
  );
  if (endpointUsed[0]) {
    throw new AppError('CONFLICT', 'one of these node ports is already linked');
  }

  const id = newId();
  await deps.db.unsafe(
    `INSERT INTO links (id, project_id, link_type, node_a_id, adapter_a, port_a, node_b_id, adapter_b, port_b,
                        status, style, filters)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10::jsonb,'{}'::jsonb)`,
    [
      id,
      input.projectId,
      portA.type,
      input.nodeAId,
      input.adapterA,
      input.portA,
      input.nodeBId,
      input.adapterB,
      input.portB,
      { type: 'straight', ...(input.style ?? {}) },
    ],
  );
  await deps.events.publish({
    type: 'link.created',
    projectId: input.projectId,
    userId,
    payload: { linkId: id, nodeAId: input.nodeAId, nodeBId: input.nodeBId },
  });
  return ensureLinkDataplane(deps, id);
}

export async function updateLink(
  deps: AppDeps,
  userId: string,
  input: { id: string; style?: Partial<LinkStyle>; suspend?: boolean },
): Promise<LinkRow> {
  const link = await getLink(deps.db, input.id);
  await requireUnlocked(deps.db, link.projectId);
  const style = input.style ? { ...link.style, ...input.style } : link.style;
  await deps.db.unsafe('UPDATE links SET style = $2::jsonb, updated_at = now() WHERE id = $1', [
    input.id,
    style,
  ]);
  if (input.suspend !== undefined && input.suspend !== link.suspend) {
    const nodeA = await getNode(deps.db, link.nodeAId);
    if (link.status === 'active' || link.status === 'suspended') {
      await deps.agents.call(nodeA.computeId, (agent) =>
        agent.updateLink({ ...specForSuspend(link), filters: {} }),
      );
    }
    await deps.db.unsafe('UPDATE links SET suspend = $2, status = $3 WHERE id = $1', [
      link.id,
      input.suspend,
      input.suspend ? 'suspended' : link.status === 'suspended' ? 'active' : link.status,
    ]);
    await deps.events.publish({
      type: 'link.status',
      projectId: link.projectId,
      userId,
      payload: { linkId: link.id, status: input.suspend ? 'suspended' : 'active' },
    });
  }
  const updated = await getLink(deps.db, input.id);
  await deps.events.publish({
    type: 'link.updated',
    projectId: link.projectId,
    userId,
    payload: { linkId: link.id },
  });
  return updated;
}

function specForSuspend(link: LinkRow): AgentLinkSpec {
  return {
    linkId: link.id,
    projectId: link.projectId,
    mode: (link.dataplane?.mode ?? 'relay') as 'kernel' | 'relay',
    captureNodeId: link.dataplane?.captureNodeId ?? null,
    filterSide: link.dataplane?.filterSide ?? null,
    laneType: link.linkType,
    endpoints: (link.dataplane?.endpoints ?? []).map((endpoint) => ({
      computeId: endpoint.computeId,
      nodeId: link.nodeAId,
      anchor: {
        kind: endpoint.anchorKind ?? 'none',
        name: endpoint.anchor === 'udp' ? null : endpoint.anchor,
      },
    })),
    peer: null,
    filters: {},
    markers: [],
  };
}

export async function deleteLink(deps: AppDeps, userId: string, linkId: string): Promise<void> {
  const link = await getLink(deps.db, linkId);
  await requireUnlocked(deps.db, link.projectId);
  const computes = [...new Set([link.nodeAId, link.nodeBId])];
  for (const nodeId of computes) {
    const node = await getNode(deps.db, nodeId);
    await deps.agents
      .call(node.computeId, (agent) => agent.deleteLink({ projectId: link.projectId, linkId }))
      .catch(() => undefined);
  }
  await releaseOwnedPorts(deps.db, link.id);
  await deps.db.unsafe('DELETE FROM links WHERE id = $1', [linkId]);
  await deps.events.publish({
    type: 'link.deleted',
    projectId: link.projectId,
    userId,
    payload: { linkId },
  });
}

export async function resetLink(deps: AppDeps, userId: string, linkId: string): Promise<LinkRow> {
  const link = await getLink(deps.db, linkId);
  await requireUnlocked(deps.db, link.projectId);
  const nodeA = await getNode(deps.db, link.nodeAId);
  await deps.agents
    .call(nodeA.computeId, (agent) => agent.deleteLink({ projectId: link.projectId, linkId }))
    .catch(() => undefined);
  await releaseOwnedPorts(deps.db, link.id);
  await deps.db.unsafe(`UPDATE links SET status = 'pending', dataplane = NULL WHERE id = $1`, [
    linkId,
  ]);
  void userId;
  return ensureLinkDataplane(deps, linkId);
}

/* --------------------------------------------------------------- filters --- */

export async function getFilters(deps: AppDeps, linkId: string): Promise<LinkFilters> {
  return (await getLink(deps.db, linkId)).filters;
}

export async function setFilters(
  deps: AppDeps,
  userId: string,
  linkId: string,
  filters: LinkFilters,
): Promise<LinkFilters> {
  const link = await getLink(deps.db, linkId);
  await requireUnlocked(deps.db, link.projectId);
  if (filters.bpf) {
    const check = Bun.spawn(['tcpdump', '-ddd', filters.bpf], { stdout: 'pipe', stderr: 'pipe' });
    const stderr = await new Response(check.stderr).text();
    const code = await check.exited;
    if (code !== 0)
      throw new AppError('BAD_REQUEST', 'invalid BPF filter', { details: stderr.trim() });
  }
  await deps.db.unsafe('UPDATE links SET filters = $2::jsonb, updated_at = now() WHERE id = $1', [
    linkId,
    filters,
  ]);
  if (link.status === 'active' || link.status === 'suspended') {
    const nodeA = await getNode(deps.db, link.nodeAId);
    const spec = buildSpec(
      { ...link, filters },
      await endpointsForExisting(deps, link),
      (link.dataplane?.mode ?? 'relay') as 'kernel' | 'relay',
      null,
      [],
    );
    await deps.agents.call(nodeA.computeId, (agent) =>
      agent.applyFilters({ spec, filters: filters as Record<string, unknown> }),
    );
  }
  await deps.events.publish({
    type: 'link.updated',
    projectId: link.projectId,
    userId,
    payload: { linkId, filters },
  });
  return filters;
}

async function endpointsForExisting(deps: AppDeps, link: LinkRow): Promise<EndpointPlan[]> {
  const nodeA = await getNode(deps.db, link.nodeAId);
  const nodeB = await getNode(deps.db, link.nodeBId);
  const plan = (node: NodeRow, adapter: number, port: number): EndpointPlan => {
    const names = anchorNames(node.nodeType, node.id, adapter, port);
    return {
      node,
      anchor: { kind: anchorKindFor(node), name: names.interfaceName ?? names.tapName },
      udp: null,
      emulatorUdp: null,
    };
  };
  return [plan(nodeA, link.adapterA, link.portA), plan(nodeB, link.adapterB, link.portB)];
}

export async function clearFilters(
  deps: AppDeps,
  userId: string,
  linkId: string,
): Promise<LinkFilters> {
  return setFilters(deps, userId, linkId, {});
}

/* --------------------------------------------------------------- capture --- */

export async function startCapture(
  deps: AppDeps,
  linkId: string,
  dlt?: string,
): Promise<CaptureState> {
  const link = await getLink(deps.db, linkId);
  if (link.status !== 'active')
    throw new AppError('NODE_NOT_RUNNING', 'link must be active to capture');
  const nodeA = await getNode(deps.db, link.nodeAId);
  const laneDlt =
    dlt ??
    (link.linkType === 'serial'
      ? 'DLT_C_HDLC'
      : link.linkType === 'atm'
        ? 'DLT_ATM_RFC1483'
        : link.linkType === 'frame_relay'
          ? 'DLT_FRELAY'
          : 'DLT_EN10MB');
  const mode = (link.dataplane?.mode ?? 'relay') as 'kernel' | 'relay';
  const result = await deps.agents.call(nodeA.computeId, (agent) =>
    agent.startCapture({
      linkId,
      projectId: link.projectId,
      mode,
      anchor: { kind: 'none', name: null },
      path: '',
      dlt: laneDlt,
    }),
  );
  const state: CaptureState = {
    active: true,
    path: result.path,
    sizeBytes: 0,
    dlt: laneDlt as CaptureState['dlt'],
    captureNodeId: link.nodeAId,
    startedAt: new Date().toISOString(),
  };
  await deps.db.unsafe('UPDATE links SET capture = $2::jsonb WHERE id = $1', [linkId, state]);
  await deps.events.publish({
    type: 'capture.started',
    projectId: link.projectId,
    payload: { linkId, path: result.path, dlt: laneDlt },
  });
  return state;
}

export async function stopCapture(deps: AppDeps, linkId: string): Promise<CaptureState> {
  const link = await getLink(deps.db, linkId);
  const nodeA = await getNode(deps.db, link.nodeAId);
  const result = await deps.agents.call(nodeA.computeId, (agent) =>
    agent.stopCapture({ projectId: link.projectId, linkId }),
  );
  const state: CaptureState = {
    active: false,
    path: result.path,
    sizeBytes: result.sizeBytes,
    dlt: (link.capture?.dlt ?? 'DLT_EN10MB') as CaptureState['dlt'],
    captureNodeId: link.nodeAId,
    startedAt: link.capture?.startedAt ?? null,
  };
  await deps.db.unsafe('UPDATE links SET capture = $2::jsonb WHERE id = $1', [linkId, state]);
  await deps.events.publish({
    type: 'capture.stopped',
    projectId: link.projectId,
    payload: { linkId, path: result.path },
  });
  return state;
}

export async function captureStatus(deps: AppDeps, linkId: string): Promise<CaptureState> {
  const link = await getLink(deps.db, linkId);
  if (!link.capture) {
    return {
      active: false,
      path: '',
      sizeBytes: 0,
      dlt: 'DLT_EN10MB',
      captureNodeId: null,
      startedAt: null,
    };
  }
  const nodeA = await getNode(deps.db, link.nodeAId);
  const status = await deps.agents
    .call(nodeA.computeId, (agent) => agent.captureStatus({ projectId: link.projectId, linkId }))
    .catch(() => ({
      active: link.capture?.active ?? false,
      path: link.capture?.path ?? '',
      sizeBytes: 0,
      dlt: link.capture?.dlt ?? 'DLT_EN10MB',
    }));
  return {
    active: status.active,
    path: status.path,
    sizeBytes: status.sizeBytes,
    dlt: status.dlt as CaptureState['dlt'],
    captureNodeId: link.nodeAId,
    startedAt: link.capture.startedAt,
  };
}

/* --------------------------------------------------------------- markers --- */

export async function listMarkers(deps: AppDeps, linkId: string): Promise<MarkerRow[]> {
  const rows = await deps.db.unsafe<
    {
      id: string;
      project_id: string;
      link_id: string;
      name: string;
      bpf: string;
      tag: number;
      color: string;
      highlight_duration: number;
      direction: 'tx' | 'rx' | null;
      enabled: boolean;
      paused: boolean;
      created_at: Date;
      updated_at: Date;
    }[]
  >('SELECT * FROM markers WHERE link_id = $1 ORDER BY tag ASC', [linkId]);
  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    linkId: row.link_id,
    name: row.name,
    bpf: row.bpf,
    tag: row.tag,
    color: row.color,
    highlightDuration: row.highlight_duration,
    direction: row.direction,
    enabled: row.enabled,
    paused: row.paused,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }));
}

export async function createMarker(
  deps: AppDeps,
  input: {
    linkId: string;
    name: string;
    bpf: string;
    color: string;
    highlightDuration: number;
    direction: 'tx' | 'rx' | null;
    enabled: boolean;
  },
): Promise<MarkerRow> {
  const link = await getLink(deps.db, input.linkId);
  await requireUnlocked(deps.db, link.projectId);
  const duplicate = await deps.db.unsafe<{ id: string }[]>(
    'SELECT id FROM markers WHERE link_id = $1 AND name = $2',
    [input.linkId, input.name],
  );
  if (duplicate[0]) throw new AppError('CONFLICT', 'marker name already used on this link');
  const tags = await deps.db.unsafe<{ tag: number }[]>(
    'SELECT tag FROM markers WHERE project_id = $1',
    [link.projectId],
  );
  const used = new Set(tags.map((row) => row.tag));
  let tag = 1;
  while (used.has(tag)) tag++;
  const id = newId();
  await deps.db.unsafe(
    `INSERT INTO markers (id, project_id, link_id, name, bpf, tag, color, highlight_duration, direction, enabled, paused)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false)`,
    [
      id,
      link.projectId,
      input.linkId,
      input.name,
      input.bpf,
      tag,
      input.color,
      input.highlightDuration,
      input.direction,
      input.enabled,
    ],
  );
  const markers = await listMarkers(deps, input.linkId);
  const marker = markers.find((row) => row.id === id);
  if (!marker) throw new AppError('INTERNAL', 'marker missing after insert');
  await reprogamMarkers(deps, link);
  return marker;
}

export async function updateMarker(
  deps: AppDeps,
  input: {
    id: string;
    name?: string;
    bpf?: string;
    color?: string;
    highlightDuration?: number;
    direction?: 'tx' | 'rx' | null;
    enabled?: boolean;
    paused?: boolean;
  },
): Promise<MarkerRow> {
  const rows = await deps.db.unsafe<{ link_id: string; project_id: string }[]>(
    'SELECT link_id, project_id FROM markers WHERE id = $1',
    [input.id],
  );
  const record = rows[0];
  if (!record) throw new AppError('NOT_FOUND', 'marker not found');
  await requireUnlocked(deps.db, record.project_id);
  await deps.db.unsafe(
    `UPDATE markers SET
       name = COALESCE($2, name),
       bpf = COALESCE($3, bpf),
       color = COALESCE($4, color),
       highlight_duration = COALESCE($5, highlight_duration),
       direction = CASE WHEN $6::boolean THEN $7 ELSE direction END,
       enabled = COALESCE($8, enabled),
       paused = COALESCE($9, paused),
       updated_at = now()
     WHERE id = $1`,
    [
      input.id,
      input.name ?? null,
      input.bpf ?? null,
      input.color ?? null,
      input.highlightDuration ?? null,
      input.direction !== undefined,
      input.direction ?? null,
      input.enabled ?? null,
      input.paused ?? null,
    ],
  );
  const link = await getLink(deps.db, record.link_id);
  await reprogamMarkers(deps, link);
  const markers = await listMarkers(deps, record.link_id);
  const marker = markers.find((row) => row.id === input.id);
  if (!marker) throw new AppError('INTERNAL', 'marker missing after update');
  return marker;
}

export async function deleteMarker(deps: AppDeps, markerId: string): Promise<void> {
  const rows = await deps.db.unsafe<{ link_id: string; project_id: string }[]>(
    'DELETE FROM markers WHERE id = $1 RETURNING link_id, project_id',
    [markerId],
  );
  const record = rows[0];
  if (!record) throw new AppError('NOT_FOUND', 'marker not found');
  const link = await getLink(deps.db, record.link_id);
  await reprogamMarkers(deps, link);
}

async function reprogamMarkers(deps: AppDeps, link: LinkRow): Promise<void> {
  if (link.status !== 'active' || !link.dataplane) return;
  const nodeA = await getNode(deps.db, link.nodeAId);
  const markers = await markerSpecs(deps, link.id);
  const spec = buildSpec(
    link,
    await endpointsForExisting(deps, link),
    (link.dataplane.mode ?? 'relay') as 'kernel' | 'relay',
    null,
    markers,
  );
  await deps.agents.call(nodeA.computeId, (agent) => agent.applyMarkers(spec));
}

/** Node start hook: create dataplane for links whose peer is running. */
export async function ensureProjectLinkDataplanes(deps: AppDeps, projectId: string): Promise<void> {
  const links = await listLinks(deps.db, projectId);
  for (const link of links) {
    if (link.status !== 'pending') continue;
    await ensureLinkDataplane(deps, link.id).catch(() => undefined);
  }
}

/** Node stop hook: drop dataplane for links touching the node. */
export async function dropNodeLinkDataplanes(deps: AppDeps, nodeId: string): Promise<void> {
  const rows = await deps.db.unsafe<{ id: string; project_id: string }[]>(
    'SELECT id, project_id FROM links WHERE node_a_id = $1 OR node_b_id = $1',
    [nodeId],
  );
  for (const row of rows) {
    const link = await getLink(deps.db, row.id);
    for (const nodeRef of [link.nodeAId, link.nodeBId]) {
      const node = await getNode(deps.db, nodeRef);
      await deps.agents
        .call(node.computeId, (agent) =>
          agent.deleteLink({ projectId: link.projectId, linkId: link.id }),
        )
        .catch(() => undefined);
    }
    await releaseOwnedPorts(deps.db, link.id);
    await deps.db.unsafe(`UPDATE links SET status = 'pending', dataplane = NULL WHERE id = $1`, [
      link.id,
    ]);
  }
}

export { linkBridgeName };
