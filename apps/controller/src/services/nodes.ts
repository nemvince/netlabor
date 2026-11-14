/** Node CRUD and lifecycle, including port allocation and agent dispatch. */

import { portsForNode } from '@netlabor/catalog';
import {
  type AgentNodeSpec,
  AppError,
  type NodeCreateInput,
  type NodePort,
  type NodeRow,
  type NodeStatus,
  type NodeType,
} from '@netlabor/contract';
import { parseJsonColumn } from '@netlabor/db';
import { decryptSecret, newId } from '@netlabor/shared';
import type { SQL } from 'bun';
import type { AppDeps } from '../implementer.ts';
import { type ImageRequirement, listImages, matchRequiredImage } from './images.ts';
import { dropNodeLinkDataplanes, ensureProjectLinkDataplanes } from './links.ts';
import { allocatePort, releaseNodePorts } from './ports.ts';
import { ensureProjectSlot, requireUnlocked } from './projects.ts';

interface NodeRecord {
  id: string;
  project_id: string;
  compute_id: string;
  compute_name: string;
  name: string;
  symbol: string;
  node_type: NodeType;
  template_id: string | null;
  x: number;
  y: number;
  z: number;
  layer: string;
  locked: boolean;
  isolated: boolean;
  console_port: number | null;
  console_type: string;
  console_auto_start: boolean;
  properties: Record<string, unknown>;
  status: NodeStatus;
  created_at: Date;
  updated_at: Date;
}

const NODE_COLUMNS = `
  n.id, n.project_id, n.compute_id, c.name AS compute_name, n.name, n.symbol, n.node_type,
  n.template_id, n.x, n.y, n.z, n.layer, n.locked, n.isolated, n.console_port, n.console_type,
  n.console_auto_start, n.properties, n.status, n.created_at, n.updated_at`;

function toNodeRow(record: NodeRecord): NodeRow {
  return {
    id: record.id,
    projectId: record.project_id,
    computeId: record.compute_id,
    computeName: record.compute_name,
    name: record.name,
    symbol: record.symbol,
    nodeType: record.node_type,
    templateId: record.template_id,
    x: Number(record.x),
    y: Number(record.y),
    z: record.z,
    layer: record.layer,
    locked: record.locked,
    isolated: record.isolated,
    consolePort: record.console_port,
    consoleType: record.console_type as NodeRow['consoleType'],
    consoleAutoStart: record.console_auto_start,
    properties: parseJsonColumn(record.properties, {}),
    status: record.status,
    ports: portsForNode(record.node_type, parseJsonColumn(record.properties, {})),
    createdAt: record.created_at.toISOString(),
    updatedAt: record.updated_at.toISOString(),
  };
}

export async function listNodes(db: SQL, projectId: string): Promise<NodeRow[]> {
  const rows = await db.unsafe<NodeRecord[]>(
    `SELECT ${NODE_COLUMNS} FROM nodes n JOIN computes c ON c.id = n.compute_id
      WHERE n.project_id = $1 ORDER BY n.created_at ASC`,
    [projectId],
  );
  return rows.map(toNodeRow);
}

export async function getNode(db: SQL, id: string): Promise<NodeRow> {
  const rows = await db.unsafe<NodeRecord[]>(
    `SELECT ${NODE_COLUMNS} FROM nodes n JOIN computes c ON c.id = n.compute_id WHERE n.id = $1`,
    [id],
  );
  const record = rows[0];
  if (!record) throw new AppError('NOT_FOUND', 'node not found');
  return toNodeRow(record);
}

interface TemplateData {
  id: string;
  name: string;
  node_type: NodeType;
  symbol: string;
  default_name_format: string;
  compute_id: string | null;
  pool_id: string | null;
  properties: Record<string, unknown> | string;
  required_images?: unknown;
  project_id?: string | null;
}

/** Compute selection: explicit, template, template pool, project pool, sole online. */
async function resolveCompute(
  deps: AppDeps,
  projectId: string,
  explicitComputeId: string | undefined,
  template: TemplateData | null,
): Promise<string> {
  const online = await deps.db.unsafe<{ id: string; name: string }[]>(
    `SELECT id, name FROM computes WHERE status = 'online' ORDER BY name`,
  );
  const requireOnline = (computeId: string): string => {
    const match = online.find((compute) => compute.id === computeId);
    if (!match) throw new AppError('AGENT_UNAVAILABLE', 'the selected compute is not online');
    return computeId;
  };

  if (explicitComputeId) return requireOnline(explicitComputeId);
  if (template?.compute_id) return requireOnline(template.compute_id);

  if (template?.pool_id) {
    const rows = await deps.db.unsafe<{ compute_id: string }[]>(
      `SELECT pc.compute_id FROM pool_computes pc JOIN computes c ON c.id = pc.compute_id
        WHERE pc.pool_id = $1 AND c.status = 'online'
        ORDER BY (SELECT count(*) FROM nodes n WHERE n.compute_id = pc.compute_id) ASC LIMIT 1`,
      [template.pool_id],
    );
    if (rows[0]) return rows[0].compute_id;
  }

  const projectPool = await deps.db.unsafe<{ pool_id: string | null }[]>(
    'SELECT pool_id FROM projects WHERE id = $1',
    [projectId],
  );
  const poolId = projectPool[0]?.pool_id;
  if (poolId) {
    const rows = await deps.db.unsafe<{ compute_id: string }[]>(
      `SELECT pc.compute_id FROM pool_computes pc JOIN computes c ON c.id = pc.compute_id
        WHERE pc.pool_id = $1 AND c.status = 'online'
        ORDER BY (SELECT count(*) FROM nodes n WHERE n.compute_id = pc.compute_id) ASC LIMIT 1`,
      [poolId],
    );
    if (rows[0]) return rows[0].compute_id;
  }

  if (online.length === 1 && online[0]) return online[0].id;
  throw new AppError('AGENT_UNAVAILABLE', 'no compute available for this node', {
    details: { onlineComputes: online.length },
  });
}

/** Image ids a node references, from disks and the flat image properties. */
function collectImageIds(properties: Record<string, unknown>): Set<string> {
  const imageIds = new Set<string>();
  const disks = properties.disks;
  if (disks && typeof disks === 'object') {
    for (const value of Object.values(disks as Record<string, unknown>)) {
      if (value && typeof value === 'object' && 'imageId' in value) {
        const imageId = value.imageId;
        if (typeof imageId === 'string') imageIds.add(imageId);
      }
    }
  }
  for (const key of ['cdromImageId', 'biosImageId', 'kernelImageId', 'initrdImageId', 'imageId']) {
    const value = properties[key];
    if (typeof value === 'string') imageIds.add(value);
  }
  return imageIds;
}

/** Image paths an agent needs to start the node (resolved from replicas). */
async function imagePathsFor(
  deps: AppDeps,
  computeId: string,
  properties: Record<string, unknown>,
): Promise<Record<string, string>> {
  const imageIds = collectImageIds(properties);
  if (imageIds.size === 0) return {};

  const rows = await deps.db.unsafe<{ image_id: string; path: string | null }[]>(
    `SELECT image_id, path FROM image_replicas
      WHERE compute_id = $1 AND state = 'present' AND image_id = ANY($2::uuid[])`,
    [computeId, [...imageIds]],
  );
  const out: Record<string, string> = {};
  for (const row of rows) if (row.path) out[row.image_id] = row.path;
  return out;
}

/** Fail fast on start when a node image is not replicated to its compute. */
async function requireNodeImages(deps: AppDeps, node: NodeRow, spec: AgentNodeSpec): Promise<void> {
  const imageIds = collectImageIds(node.properties);
  const missing = [...imageIds].filter((id) => !spec.images[id]);
  if (missing.length === 0) return;
  const rows = await deps.db.unsafe<{ name: string }[]>(
    'SELECT name FROM images WHERE id = ANY($1::uuid[])',
    [missing],
  );
  const compute = await deps.db.unsafe<{ name: string }[]>(
    'SELECT name FROM computes WHERE id = $1',
    [node.computeId],
  );
  const names = rows.map((row) => row.name);
  throw new AppError(
    'BAD_REQUEST',
    `image ${names.join(', ')} is not present on compute ${compute[0]?.name ?? node.computeId}; replicate it from the Images page before starting ${node.name}`,
  );
}

export async function buildAgentSpec(deps: AppDeps, node: NodeRow): Promise<AgentNodeSpec> {
  const properties = { ...node.properties };
  if (node.nodeType === 'iou') {
    const applicationId =
      typeof properties.applicationId === 'number' ? properties.applicationId : null;
    const secretId = typeof properties.iourcSecretId === 'string' ? properties.iourcSecretId : null;
    if (secretId) {
      const rows = await deps.db.unsafe<{ ciphertext: Uint8Array; nonce: Uint8Array }[]>(
        'SELECT ciphertext, nonce FROM secrets WHERE id = $1',
        [secretId],
      );
      const secret = rows[0];
      if (secret) {
        try {
          properties.__iourc = decryptSecret(
            { ciphertext: new Uint8Array(secret.ciphertext), nonce: new Uint8Array(secret.nonce) },
            deps.config.secretKey,
          );
        } catch {
          // a broken secret surfaces as LICENSE_MISSING at start
        }
      }
    }
    properties.applicationId = applicationId;
  }
  const auxExternalPort =
    node.nodeType === 'dynamips' && node.properties.auxConsole === true
      ? await deps.db
          .unsafe<{ port: number }[]>(
            'SELECT port FROM port_allocations WHERE compute_id = $1 AND owner_id = $2 AND kind = $3',
            [node.computeId, node.id, 'aux'],
          )
          .then((rows) => rows[0]?.port ?? null)
      : null;
  return {
    nodeId: node.id,
    projectId: node.projectId,
    computeId: node.computeId,
    name: node.name,
    nodeType: node.nodeType,
    templateId: node.templateId,
    properties,
    ports: node.ports.map((port) => ({
      adapter: port.adapter,
      port: port.port,
      laneType: port.type,
      anchor: { kind: 'none', name: null },
      vlan: null,
    })),
    console: {
      type: node.consoleType,
      externalPort: node.consolePort,
      auxExternalPort,
    },
    applicationId:
      node.nodeType === 'iou' && typeof properties.applicationId === 'number'
        ? properties.applicationId
        : null,
    images: await imagePathsFor(deps, node.computeId, node.properties),
  };
}

const EMULATOR_KEYS = new Set([
  'ram',
  'cpus',
  'adapters',
  'adapterType',
  'imageId',
  'imageName',
  'disks',
  'cdromImageId',
  'biosImageId',
  'kernelImageId',
  'initrdImageId',
  'kernelCommandLine',
  'machineType',
  'cpuModel',
  'options',
  'slots',
  'wics',
  'platform',
  'npe',
  'midplane',
  'startCommand',
  'environment',
  'ethernetAdapters',
  'serialAdapters',
  'portsMapping',
  'mappings',
]);

export async function createNode(
  deps: AppDeps,
  userId: string,
  input: NodeCreateInput,
): Promise<NodeRow> {
  await requireUnlocked(deps.db, input.projectId);
  const project = await deps.db.unsafe<{ id: string; status: string }[]>(
    'SELECT id, status FROM projects WHERE id = $1',
    [input.projectId],
  );
  if (!project[0]) throw new AppError('NOT_FOUND', 'project not found');
  const nodeCounts = await deps.db.unsafe<{ count: string }[]>(
    'SELECT count(*)::text AS count FROM nodes WHERE project_id = $1',
    [input.projectId],
  );
  if (Number(nodeCounts[0]?.count ?? '0') >= deps.config.maxNodesPerProject) {
    throw new AppError(
      'CONFLICT',
      `project has reached its ${deps.config.maxNodesPerProject}-node limit`,
      { details: { maxNodesPerProject: deps.config.maxNodesPerProject } },
    );
  }

  const template = input.templateId
    ? ((
        await deps.db.unsafe<TemplateData[]>(
          `SELECT id, name, node_type, symbol, default_name_format, compute_id, pool_id, properties,
                  required_images, project_id
             FROM templates WHERE id = $1`,
          [input.templateId],
        )
      )[0] ?? null)
    : null;
  if (input.templateId && !template) throw new AppError('NOT_FOUND', 'template not found');
  if (template?.project_id && template.project_id !== input.projectId) {
    throw new AppError('BAD_REQUEST', 'template belongs to another project');
  }

  const nodeType = (template?.node_type ?? input.nodeType) as NodeType | undefined;
  if (!nodeType) throw new AppError('BAD_REQUEST', 'nodeType or templateId is required');

  const templateProperties = template
    ? parseJsonColumn<Record<string, unknown>>(template.properties, {})
    : {};
  const properties = { ...templateProperties, ...(input.properties ?? {}) };
  await resolveTemplateImage(deps, nodeType, template, properties);
  const computeId = await resolveCompute(deps, input.projectId, input.computeId, template);

  const existingNames = await deps.db.unsafe<{ name: string }[]>(
    'SELECT name FROM nodes WHERE project_id = $1',
    [input.projectId],
  );
  const name =
    input.name ??
    nextNodeName(
      template?.default_name_format ?? '{name}-{index}',
      nodeType,
      existingNames.map((row) => row.name),
    );
  // Each node keeps its own hostname; an inherited template hostname would
  // give every machine the same one.
  if (properties.cloudInitEnabled === true) {
    const hostname =
      typeof properties.cloudInitHostname === 'string' ? properties.cloudInitHostname.trim() : '';
    if (hostname === '') properties.cloudInitHostname = name;
  }

  const id = newId();
  // NAT nodes are host bridges, never interactive consoles.
  const consoleType =
    nodeType === 'nat'
      ? 'none'
      : ((properties.consoleType as NodeRow['consoleType'] | undefined) ?? 'telnet');
  if (nodeType === 'nat') properties.consoleType = 'none';
  const consolePort =
    consoleType === 'none' ? null : await allocatePort(deps.db, computeId, 'console', id);
  if (nodeType === 'iou') {
    properties.applicationId = await allocatePort(deps.db, computeId, 'iou_app', id);
  }
  if (nodeType === 'dynamips' && properties.auxConsole === true) {
    await allocatePort(deps.db, computeId, 'aux', id);
  }

  await deps.db.unsafe(
    `INSERT INTO nodes (id, project_id, compute_id, name, symbol, node_type, template_id, x, y, z, layer,
                        console_port, console_type, console_auto_start, properties, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,'stopped')`,
    [
      id,
      input.projectId,
      computeId,
      name,
      input.symbol ?? template?.symbol ?? 'router',
      nodeType,
      template?.id ?? null,
      input.x,
      input.y,
      input.z,
      input.layer,
      consolePort,
      consoleType,
      properties.consoleAutoStart !== false,
      properties,
    ],
  );

  try {
    await ensureProjectSlot(deps, input.projectId, computeId);
    const node = await getNode(deps.db, id);
    const spec = await buildAgentSpec(deps, node);
    await deps.agents.call(computeId, (agent) => agent.createNode(spec));
  } catch (error) {
    await deps.db.unsafe('DELETE FROM nodes WHERE id = $1', [id]);
    await releaseNodePorts(deps.db, computeId, id);
    throw error;
  }

  const node = await getNode(deps.db, id);
  await deps.events.publish({
    type: 'node.created',
    projectId: input.projectId,
    userId,
    payload: { nodeId: id, name: node.name, nodeType, computeId },
  });
  return node;
}

/**
 * Fill in the image a template requires (uploaded image picked up by name,
 * pattern or sha) when the node has none configured yet.
 */
async function resolveTemplateImage(
  deps: AppDeps,
  nodeType: NodeType,
  template: TemplateData | null,
  properties: Record<string, unknown>,
): Promise<void> {
  const required = template
    ? parseJsonColumn<ImageRequirement[]>(template.required_images, [])
    : [];
  const disks = (properties.disks ?? {}) as Record<string, { imageId?: string } | undefined>;
  const needsImage =
    nodeType === 'iou' || nodeType === 'dynamips'
      ? !properties.imageId
      : nodeType === 'qemu'
        ? !disks.hda?.imageId && !properties.cdromImageId
        : false;
  if (!needsImage) return;
  const kind =
    nodeType === 'iou' || nodeType === 'dynamips' || nodeType === 'qemu' ? nodeType : null;
  if (!kind) return;
  const images = (await listImages(deps.db, { limit: 500, offset: 0 })).filter(
    (image) => image.kind === kind,
  );
  if (images.length === 0) return;
  let match =
    required.length > 0 ? matchRequiredImage(images, required[0] as ImageRequirement) : undefined;
  if (!match) {
    // No (matching) requirement: prefer a library image whose name shares
    // tokens with the template name, e.g. "IOU L2" -> the L2 IOU image.
    const tokens = new Set(
      `${template?.name ?? ''} ${nodeType}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 2),
    );
    const scored = images
      .map((image) => {
        const haystack = `${image.name} ${image.filename}`.toLowerCase();
        let score = 0;
        for (const token of tokens) if (haystack.includes(token)) score += 1;
        return { image, score };
      })
      .sort((a, b) => b.score - a.score);
    match = scored[0]?.image;
  }
  if (!match) return;
  if (nodeType === 'qemu') {
    properties.disks = { ...disks, hda: { ...disks.hda, imageId: match.id } };
  } else {
    properties.imageId = match.id;
  }
}

function nextNodeName(format: string, nodeType: string, existing: string[]): string {
  const base = format.replaceAll('{name}', nodeType).replace(/\{index\}/g, '');
  let index = 1;
  const taken = new Set(existing);
  while (taken.has(`${base}${index}`)) index++;
  return `${base}${index}`;
}

export async function updateNode(
  deps: AppDeps,
  userId: string,
  input: {
    id: string;
    name?: string;
    x?: number;
    y?: number;
    z?: number;
    layer?: string;
    locked?: boolean;
    symbol?: string;
    properties?: Record<string, unknown>;
    consoleAutoStart?: boolean;
  },
): Promise<NodeRow> {
  const node = await getNode(deps.db, input.id);
  const project = await deps.db.unsafe<{ locked: boolean }[]>(
    'SELECT locked FROM projects WHERE id = $1',
    [node.projectId],
  );
  if (project[0]?.locked) throw new AppError('CONFLICT', 'project is locked');

  const mergedProperties = input.properties
    ? { ...node.properties, ...input.properties }
    : node.properties;
  const touchesEmulator =
    input.properties !== undefined &&
    Object.keys(input.properties).some((key) => EMULATOR_KEYS.has(key));
  if (touchesEmulator && node.status !== 'stopped') {
    throw new AppError('NODE_BUSY', 'stop the node before changing emulator properties');
  }

  await deps.db.unsafe(
    `UPDATE nodes SET
       name = COALESCE($2, name),
       x = COALESCE($3, x),
       y = COALESCE($4, y),
       z = COALESCE($5, z),
       layer = COALESCE($6, layer),
       locked = COALESCE($7, locked),
       symbol = COALESCE($8, symbol),
       console_auto_start = COALESCE($9, console_auto_start),
       properties = $10::jsonb,
       updated_at = now()
     WHERE id = $1`,
    [
      input.id,
      input.name ?? null,
      input.x ?? null,
      input.y ?? null,
      input.z ?? null,
      input.layer ?? null,
      input.locked ?? null,
      input.symbol ?? null,
      input.consoleAutoStart ?? null,
      mergedProperties,
    ],
  );

  const updated = await getNode(deps.db, input.id);
  if (input.properties) {
    const spec = await buildAgentSpec(deps, updated);
    await deps.agents.call(updated.computeId, (agent) =>
      agent.updateNode({ spec, requireStopped: touchesEmulator }),
    );
  }
  await deps.events.publish({
    type: 'node.updated',
    projectId: updated.projectId,
    userId,
    payload: { nodeId: updated.id, name: updated.name },
  });
  return updated;
}

export async function deleteNode(deps: AppDeps, userId: string, nodeId: string): Promise<void> {
  const node = await getNode(deps.db, nodeId);
  const project = await deps.db.unsafe<{ locked: boolean }[]>(
    'SELECT locked FROM projects WHERE id = $1',
    [node.projectId],
  );
  if (project[0]?.locked) throw new AppError('CONFLICT', 'project is locked');

  if (node.status !== 'stopped') {
    await deps.agents
      .call(node.computeId, (agent) => agent.stopNode({ projectId: node.projectId, nodeId }))
      .catch(() => undefined);
  }

  const links = await deps.db.unsafe<{ id: string; node_a_id: string; node_b_id: string }[]>(
    'SELECT id, node_a_id, node_b_id FROM links WHERE node_a_id = $1 OR node_b_id = $1',
    [nodeId],
  );
  for (const link of links) {
    const peerNodeId = link.node_a_id === nodeId ? link.node_b_id : link.node_a_id;
    const peers = await deps.db.unsafe<{ compute_id: string }[]>(
      'SELECT compute_id FROM nodes WHERE id = $1',
      [peerNodeId],
    );
    const peerCompute = peers[0]?.compute_id;
    if (peerCompute) {
      await deps.agents
        .call(peerCompute, (agent) =>
          agent.deleteLink({ projectId: node.projectId, linkId: link.id }),
        )
        .catch(() => undefined);
    }
    await deps.db.unsafe('DELETE FROM links WHERE id = $1', [link.id]);
  }

  await deps.agents
    .call(node.computeId, (agent) => agent.deleteNode({ projectId: node.projectId, nodeId }))
    .catch(() => undefined);
  await deps.db.unsafe('DELETE FROM nodes WHERE id = $1', [nodeId]);
  await releaseNodePorts(deps.db, node.computeId, nodeId);
  await deps.events.publish({
    type: 'node.deleted',
    projectId: node.projectId,
    userId,
    payload: { nodeId, name: node.name },
  });
}

/** Re-assert the node console port reservation after a project reopen or restart. */
export async function ensureNodeConsoleAllocation(deps: AppDeps, nodeId: string): Promise<void> {
  const rows = await deps.db.unsafe<
    { id: string; compute_id: string; console_port: number | null; console_type: string }[]
  >('SELECT id, compute_id, console_port, console_type FROM nodes WHERE id = $1', [nodeId]);
  const node = rows[0];
  if (!node || node.console_port === null || node.console_type === 'none') return;
  const slot = await deps.db.unsafe<{ owner_id: string | null }[]>(
    'SELECT owner_id FROM port_allocations WHERE compute_id = $1 AND port = $2',
    [node.compute_id, node.console_port],
  );
  if (slot[0]?.owner_id === node.id) return;
  if (slot[0]) {
    const replacement = await allocatePort(
      deps.db,
      node.compute_id,
      node.console_type === 'vnc' ? 'vnc' : 'console',
      node.id,
    );
    await deps.db.unsafe('UPDATE nodes SET console_port = $2, updated_at = now() WHERE id = $1', [
      node.id,
      replacement,
    ]);
    return;
  }
  await deps.db.unsafe(
    `INSERT INTO port_allocations (compute_id, port, kind, side, owner_id)
     VALUES ($1, $2, $3, NULL, $4) ON CONFLICT (compute_id, port) DO NOTHING`,
    [node.compute_id, node.console_port, node.console_type === 'vnc' ? 'vnc' : 'console', node.id],
  );
}

/** Repair console/vnc port reservations for all nodes at controller startup. */
export async function reconcileNodeConsolePorts(deps: AppDeps): Promise<void> {
  const rows = await deps.db.unsafe<
    {
      id: string;
      compute_id: string;
      console_port: number | null;
      console_type: string;
      status: string;
    }[]
  >(
    `SELECT id, compute_id, console_port, console_type, status FROM nodes
      WHERE console_port IS NOT NULL AND console_type <> 'none'
      ORDER BY created_at ASC`,
  );
  const used = new Map<string, Set<number>>();
  for (const node of rows) {
    if (node.console_port === null) continue;
    const key = node.compute_id;
    const ports = used.get(key) ?? new Set<number>();
    let port = node.console_port;
    if (ports.has(port)) {
      port = await allocatePort(
        deps.db,
        node.compute_id,
        node.console_type === 'vnc' ? 'vnc' : 'console',
        node.id,
      );
      await deps.db.unsafe('UPDATE nodes SET console_port = $2, updated_at = now() WHERE id = $1', [
        node.id,
        port,
      ]);
    } else {
      await deps.db.unsafe(
        `INSERT INTO port_allocations (compute_id, port, kind, side, owner_id)
         VALUES ($1, $2, $3, NULL, $4)
         ON CONFLICT (compute_id, port) DO UPDATE SET owner_id = EXCLUDED.owner_id`,
        [node.compute_id, port, node.console_type === 'vnc' ? 'vnc' : 'console', node.id],
      );
    }
    ports.add(port);
    used.set(key, ports);
  }
}

/** Start/stop/suspend/reload through the hosting agent. */
export async function setNodePower(
  deps: AppDeps,
  userId: string,
  nodeId: string,
  action: 'start' | 'stop' | 'suspend' | 'reload',
): Promise<{ id: string; status: NodeStatus }> {
  await ensureNodeConsoleAllocation(deps, nodeId);
  const node = await getNode(deps.db, nodeId);
  const spec = await buildAgentSpec(deps, node);

  if (action === 'start' || action === 'reload') {
    // The agent may have restarted; re-assert the project namespace first.
    await ensureProjectSlot(deps, node.projectId, node.computeId);
    await requireNodeImages(deps, node, spec);
  }

  switch (action) {
    case 'start': {
      const status = await deps.agents.call(node.computeId, (agent) => agent.startNode(spec));
      await deps.db.unsafe('UPDATE nodes SET status = $2, updated_at = now() WHERE id = $1', [
        nodeId,
        status.status,
      ]);
      await ensureProjectLinkDataplanes(deps, node.projectId);
      break;
    }
    case 'stop': {
      await dropNodeLinkDataplanes(deps, nodeId);
      const status = await deps.agents.call(node.computeId, (agent) =>
        agent.stopNode({ projectId: node.projectId, nodeId }),
      );
      await deps.db.unsafe('UPDATE nodes SET status = $2, updated_at = now() WHERE id = $1', [
        nodeId,
        status.status,
      ]);
      break;
    }
    case 'suspend': {
      const status = await deps.agents.call(node.computeId, (agent) =>
        agent.suspendNode({ projectId: node.projectId, nodeId }),
      );
      await deps.db.unsafe('UPDATE nodes SET status = $2, updated_at = now() WHERE id = $1', [
        nodeId,
        status.status,
      ]);
      break;
    }
    case 'reload': {
      await dropNodeLinkDataplanes(deps, nodeId);
      const status = await deps.agents.call(node.computeId, (agent) => agent.reloadNode(spec));
      await deps.db.unsafe('UPDATE nodes SET status = $2, updated_at = now() WHERE id = $1', [
        nodeId,
        status.status,
      ]);
      await ensureProjectLinkDataplanes(deps, node.projectId);
      break;
    }
  }

  const updated = await getNode(deps.db, nodeId);
  await deps.events.publish({
    type: 'node.status',
    projectId: node.projectId,
    userId,
    payload: { nodeId, status: updated.status, action },
  });
  return { id: nodeId, status: updated.status };
}

export async function duplicateNode(
  deps: AppDeps,
  userId: string,
  input: { id: string; x?: number; y?: number; name?: string },
): Promise<NodeRow> {
  const source = await getNode(deps.db, input.id);
  const duplicate = await createNode(deps, userId, {
    projectId: source.projectId,
    computeId: source.computeId,
    nodeType: source.nodeType,
    ...(input.name ? { name: input.name } : {}),
    x: input.x ?? source.x + 40,
    y: input.y ?? source.y + 40,
    z: source.z,
    layer: source.layer,
    symbol: source.symbol,
    properties: source.properties,
  });
  await deps.agents
    .call(source.computeId, (agent) =>
      agent.duplicateNode({
        projectId: source.projectId,
        nodeId: source.id,
        targetNodeId: duplicate.id,
      }),
    )
    .catch(() => undefined);
  return duplicate;
}

export function nodePortOrThrow(row: NodeRow, adapter: number, port: number): NodePort {
  const match = row.ports.find((entry) => entry.adapter === adapter && entry.port === port);
  if (!match) {
    throw new AppError('BAD_REQUEST', `port ${adapter}/${port} does not exist on ${row.name}`);
  }
  return match;
}
