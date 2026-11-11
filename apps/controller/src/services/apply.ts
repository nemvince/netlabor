/** Declarative project apply: incremental upsert of nodes, links, and drawings. */

import { portsForNode } from '@netlabor/catalog';
import {
  AppError,
  type LinkRow,
  type LinkType,
  type NodePort,
  type NodeRow,
  type NodeType,
  type Privilege,
  type ProjectApplyInput,
  type ProjectApplyLinkInput,
  type ProjectApplyResult,
  type ProjectRow,
} from '@netlabor/contract';
import { parseJsonColumn } from '@netlabor/db';
import { assertSafeRelative, newId } from '@netlabor/shared';
import type { SQL } from 'bun';
import { hasPrivilege } from '../auth/principal.ts';
import type { AuthInfo } from '../context.ts';
import type { AppDeps } from '../implementer.ts';
import { createLink, deleteLink, listLinks, updateLink } from './links.ts';
import { createNode, deleteNode, listNodes, setNodePower, updateNode } from './nodes.ts';
import {
  createProject,
  getProject,
  openProject,
  requireUnlocked,
  updateProject,
  visibleProjectIds,
} from './projects.ts';
import { sanitizeSvg } from './symbols.ts';
import { getTemplate } from './templates.ts';

/* ------------------------------------------------------------- link plan --- */

export interface ApplyNodePlan {
  name: string;
  existingId: string | null;
  ports: NodePort[];
}

export interface ApplyLinkPlan {
  link: ProjectApplyLinkInput;
  matched: LinkRow | null;
  a: NodePort;
  b: NodePort;
}

/** Planned endpoint key; new nodes have no id yet, so their name namespaces them. */
function nodeKey(plan: ApplyNodePlan): string {
  return plan.existingId ?? `new:${plan.name}`;
}

function endpointKey(key: string, port: NodePort): string {
  return `${key}:${port.adapter}:${port.port}`;
}

function namedPort(plan: ApplyNodePlan, name: string, linkType: LinkType): NodePort {
  const port = plan.ports.find((entry) => entry.name === name);
  if (!port) {
    throw new AppError('BAD_REQUEST', `port ${name} does not exist on node ${plan.name}`);
  }
  if (port.type !== linkType) {
    throw new AppError('BAD_REQUEST', `port ${name} on node ${plan.name} is ${port.type}`);
  }
  return port;
}

function endpointPort(
  plan: ApplyNodePlan,
  adapter: number,
  port: number,
  linkType: LinkType,
): NodePort {
  return (
    plan.ports.find((entry) => entry.adapter === adapter && entry.port === port) ?? {
      adapter,
      port,
      name: `port${adapter}/${port}`,
      type: linkType,
    }
  );
}

/**
 * Match manifest links to existing links and choose the ports each new link
 * uses. Pure apart from `AppError`; run it before any mutation so port
 * planning failures cannot leave a half-applied project.
 */
export function planApplyLinks(
  nodePlans: ReadonlyMap<string, ApplyNodePlan>,
  existingLinks: LinkRow[],
  manifestLinks: ProjectApplyLinkInput[],
): ApplyLinkPlan[] {
  const used = new Set<string>();
  for (const link of existingLinks) {
    const keyA = `${link.nodeAId}:${link.adapterA}:${link.portA}`;
    const keyB = `${link.nodeBId}:${link.adapterB}:${link.portB}`;
    used.add(keyA);
    used.add(keyB);
  }

  const matchedIds = new Set<string>();
  const plans: ApplyLinkPlan[] = [];

  for (const link of manifestLinks) {
    const a = nodePlans.get(link.a);
    const b = nodePlans.get(link.b);
    if (!a) throw new AppError('BAD_REQUEST', `unknown node ${link.a}`);
    if (!b) throw new AppError('BAD_REQUEST', `unknown node ${link.b}`);
    if (link.a === link.b) throw new AppError('BAD_REQUEST', 'a link needs two different nodes');
    if ((link.aPort === undefined) !== (link.bPort === undefined)) {
      throw new AppError('BAD_REQUEST', 'aPort and bPort must be supplied together');
    }
    const requestedA = link.aPort ? namedPort(a, link.aPort, link.type) : null;
    const requestedB = link.bPort ? namedPort(b, link.bPort, link.type) : null;

    let matched: LinkRow | null = null;
    if (a.existingId && b.existingId) {
      for (const row of existingLinks) {
        if (matchedIds.has(row.id) || row.linkType !== link.type) continue;
        const samePair =
          (row.nodeAId === a.existingId && row.nodeBId === b.existingId) ||
          (row.nodeAId === b.existingId && row.nodeBId === a.existingId);
        if (!samePair) continue;
        if (requestedA && requestedB) {
          const aIsRowA = row.nodeAId === a.existingId;
          const rowAPort = aIsRowA
            ? { adapter: row.adapterA, port: row.portA }
            : { adapter: row.adapterB, port: row.portB };
          const rowBPort = aIsRowA
            ? { adapter: row.adapterB, port: row.portB }
            : { adapter: row.adapterA, port: row.portA };
          const samePorts =
            rowAPort.adapter === requestedA.adapter &&
            rowAPort.port === requestedA.port &&
            rowBPort.adapter === requestedB.adapter &&
            rowBPort.port === requestedB.port;
          if (!samePorts) continue;
        }
        matched = row;
        break;
      }
    }

    if (matched) {
      matchedIds.add(matched.id);
      const aIsRowA = matched.nodeAId === a.existingId;
      const portA = endpointPort(
        a,
        aIsRowA ? matched.adapterA : matched.adapterB,
        aIsRowA ? matched.portA : matched.portB,
        matched.linkType,
      );
      const portB = endpointPort(
        b,
        aIsRowA ? matched.adapterB : matched.adapterA,
        aIsRowA ? matched.portB : matched.portA,
        matched.linkType,
      );
      used.add(endpointKey(nodeKey(a), portA));
      used.add(endpointKey(nodeKey(b), portB));
      plans.push({ link, matched, a: portA, b: portB });
      continue;
    }

    let chosenA: NodePort;
    let chosenB: NodePort;
    if (requestedA && requestedB) {
      if (used.has(endpointKey(nodeKey(a), requestedA))) {
        throw new AppError(
          'CONFLICT',
          `port ${requestedA.name} on node ${a.name} is already linked`,
        );
      }
      if (used.has(endpointKey(nodeKey(b), requestedB))) {
        throw new AppError(
          'CONFLICT',
          `port ${requestedB.name} on node ${b.name} is already linked`,
        );
      }
      chosenA = requestedA;
      chosenB = requestedB;
    } else {
      const freeA = a.ports.find(
        (entry) => entry.type === link.type && !used.has(endpointKey(nodeKey(a), entry)),
      );
      if (!freeA) {
        throw new AppError('BAD_REQUEST', `no free ${link.type} port on node ${a.name}`);
      }
      const freeB = b.ports.find(
        (entry) => entry.type === link.type && !used.has(endpointKey(nodeKey(b), entry)),
      );
      if (!freeB) {
        throw new AppError('BAD_REQUEST', `no free ${link.type} port on node ${b.name}`);
      }
      chosenA = freeA;
      chosenB = freeB;
    }
    used.add(endpointKey(nodeKey(a), chosenA));
    used.add(endpointKey(nodeKey(b), chosenB));
    plans.push({ link, matched: null, a: chosenA, b: chosenB });
  }

  return plans;
}

/* -------------------------------------------------------------- preflight --- */

interface TemplateData {
  id: string;
  nodeType: NodeType;
  properties: Record<string, unknown>;
}

interface ResolvedNode {
  input: ProjectApplyInput['nodes'][number];
  existing: NodeRow | null;
  templateId: string | null;
  nodeType: NodeType;
  /** Properties used to plan ports; createNode merges template properties itself. */
  ports: NodePort[];
  filesChanged: boolean;
  fieldsChanged: boolean;
}

const NODE_UPDATE_FIELDS = [
  'x',
  'y',
  'z',
  'layer',
  'symbol',
  'locked',
  'consoleAutoStart',
  'properties',
] as const;

async function templateByName(db: SQL, name: string): Promise<TemplateData> {
  const rows = await db.unsafe<
    { id: string; node_type: NodeType; properties: Record<string, unknown> | string }[]
  >(
    `SELECT id, node_type, properties
       FROM templates
      WHERE deleted_at IS NULL AND name = $1
      ORDER BY builtin DESC, created_at ASC`,
    [name],
  );
  if (rows.length === 0) throw new AppError('BAD_REQUEST', `template ${name} not found`);
  if (rows.length > 1) {
    throw new AppError('CONFLICT', `template name ${name} is ambiguous; use templateId`);
  }
  const row = rows[0] as { id: string; node_type: NodeType; properties: unknown };
  return {
    id: row.id,
    nodeType: row.node_type,
    properties: parseJsonColumn<Record<string, unknown>>(row.properties, {}),
  };
}

/* ------------------------------------------------------------------ apply --- */

function requirePrivilegeFor(auth: AuthInfo, privilege: Privilege, projectId: string | null): void {
  if (!hasPrivilege(auth, privilege, projectId)) {
    throw new AppError('FORBIDDEN', `missing privilege ${privilege}`);
  }
}

interface ResolvedProject {
  project: ProjectRow;
  created: boolean;
  /** Project scope for privilege checks; null while the project does not exist. */
  scope: string | null;
}

async function resolveProject(
  deps: AppDeps,
  userId: string,
  auth: AuthInfo,
  input: ProjectApplyInput,
): Promise<ResolvedProject> {
  if (input.projectId) {
    const project = await getProject(deps.db, input.projectId);
    if (input.name && input.name !== project.name) {
      throw new AppError('BAD_REQUEST', 'name cannot rename an existing project');
    }
    await requireUnlocked(deps.db, project.id);
    return { project, created: false, scope: project.id };
  }
  if (!input.name) throw new AppError('BAD_REQUEST', 'name or projectId is required');

  const visible = await visibleProjectIds(deps.db, auth);
  if (visible !== 'all' && visible.length === 0) {
    return createNamedProject(deps, userId, input);
  }
  const rows = await deps.db.unsafe<{ id: string }[]>(
    `SELECT id FROM projects
      WHERE name = $1 AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))`,
    [input.name, visible === 'all' ? null : visible],
  );
  if (rows.length > 1) {
    throw new AppError('CONFLICT', 'project name is ambiguous; pass projectId');
  }
  const found = rows[0];
  if (!found) return createNamedProject(deps, userId, input);

  const project = await getProject(deps.db, found.id);
  await requireUnlocked(deps.db, project.id);
  return { project, created: false, scope: project.id };
}

async function createNamedProject(
  deps: AppDeps,
  userId: string,
  input: ProjectApplyInput,
): Promise<ResolvedProject> {
  if (!input.name) throw new AppError('BAD_REQUEST', 'name or projectId is required');
  const project = await createProject(deps, userId, {
    name: input.name,
    description: input.description ?? null,
    variables: input.variables ?? {},
    autoOpen: false,
    autoClose: false,
    autoStart: false,
  });
  return { project, created: true, scope: null };
}

export async function applyProject(
  deps: AppDeps,
  userId: string,
  auth: AuthInfo,
  input: ProjectApplyInput,
): Promise<ProjectApplyResult> {
  const resolvedProject = await resolveProject(deps, userId, auth, input);
  const projectId = resolvedProject.project.id;
  const scope = resolvedProject.scope;

  /* Metadata ------------------------------------------------------------- */
  const hasMetadata =
    input.description !== undefined || input.variables !== undefined || input.scene !== undefined;
  let project = resolvedProject.project;
  if (hasMetadata) {
    project = await updateProject(deps, {
      id: projectId,
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.variables !== undefined ? { variables: input.variables } : {}),
      ...(input.scene !== undefined ? { scene: input.scene } : {}),
    });
  }

  /* Nodes and files preflight -------------------------------------------- */
  const existingNodes = await listNodes(deps.db, projectId);
  const existingByName = new Map<string, NodeRow>();
  for (const node of existingNodes) {
    if (existingByName.has(node.name)) {
      throw new AppError('CONFLICT', `node name ${node.name} is not unique in this project`);
    }
    existingByName.set(node.name, node);
  }

  const manifestNames = new Set<string>();
  const resolvedNodes: ResolvedNode[] = [];
  const nodePlans = new Map<string, ApplyNodePlan>();

  for (const node of input.nodes) {
    if (manifestNames.has(node.name)) {
      throw new AppError('BAD_REQUEST', `duplicate node name ${node.name}`);
    }
    manifestNames.add(node.name);
    if (node.template && node.templateId) {
      throw new AppError('BAD_REQUEST', `node ${node.name}: template and templateId are exclusive`);
    }

    const existing = existingByName.get(node.name) ?? null;
    let template: TemplateData | null = null;
    if (node.template) template = await templateByName(deps.db, node.template);
    else if (node.templateId) {
      const row = await getTemplate(deps.db, node.templateId);
      template = {
        id: row.id,
        nodeType: row.nodeType,
        properties: row.properties as Record<string, unknown>,
      };
    }
    if (template && node.nodeType && node.nodeType !== template.nodeType) {
      throw new AppError(
        'BAD_REQUEST',
        `node ${node.name}: nodeType ${node.nodeType} does not match template ${template.nodeType}`,
      );
    }

    const files: ProjectApplyInput['nodes'][number]['files'] = node.files;
    const seenPaths = new Set<string>();
    for (const file of files) {
      try {
        assertSafeRelative(file.path);
      } catch {
        throw new AppError('BAD_REQUEST', `node ${node.name}: unsafe file path ${file.path}`);
      }
      if (seenPaths.has(file.path)) {
        throw new AppError('BAD_REQUEST', `node ${node.name}: duplicate file path ${file.path}`);
      }
      seenPaths.add(file.path);
    }

    let nodeType: NodeType;
    let properties: Record<string, unknown>;
    let ports: NodePort[];
    let filesChanged: boolean;
    let fieldsChanged: boolean;

    if (existing) {
      if (node.nodeType && node.nodeType !== existing.nodeType) {
        throw new AppError('CONFLICT', `node ${node.name}: node type cannot change`);
      }
      if (template && template.id !== existing.templateId) {
        throw new AppError('CONFLICT', `node ${node.name}: template cannot change`);
      }
      if (node.computeId && node.computeId !== existing.computeId) {
        throw new AppError('CONFLICT', `node ${node.name}: compute cannot change`);
      }
      if (files.length > 0 && existing.status === 'started') {
        throw new AppError('NODE_BUSY', `node ${node.name} must be stopped to write files`);
      }
      nodeType = existing.nodeType;
      properties = { ...existing.properties, ...(node.properties ?? {}) };
      ports = existing.ports;
      filesChanged = files.length > 0;
      fieldsChanged = NODE_UPDATE_FIELDS.some((field) => node[field] !== undefined);
    } else {
      const resolvedType = template?.nodeType ?? node.nodeType;
      if (!resolvedType) {
        throw new AppError('BAD_REQUEST', `node ${node.name}: nodeType or template is required`);
      }
      nodeType = resolvedType;
      properties = { ...(template?.properties ?? {}), ...(node.properties ?? {}) };
      ports = portsForNode(nodeType, properties);
      filesChanged = files.length > 0;
      fieldsChanged = true;
    }

    resolvedNodes.push({
      input: node,
      existing,
      templateId: template?.id ?? null,
      nodeType,
      ports,
      filesChanged,
      fieldsChanged,
    });
    nodePlans.set(node.name, { name: node.name, existingId: existing?.id ?? null, ports });
  }

  /* Links preflight ------------------------------------------------------- */
  const existingLinks = await listLinks(deps.db, projectId);
  const linkPlans = planApplyLinks(nodePlans, existingLinks, input.links);
  const matchedLinkIds = new Set<string>();
  for (const plan of linkPlans) if (plan.matched) matchedLinkIds.add(plan.matched.id);
  const prunedLinks = input.prune ? existingLinks.filter((l) => !matchedLinkIds.has(l.id)) : [];
  const prunedNodes = input.prune ? existingNodes.filter((n) => !manifestNames.has(n.name)) : [];

  /* Drawings preflight ---------------------------------------------------- */
  const drawingKeys = new Set<string>();
  for (const drawing of input.drawings) {
    if (drawingKeys.has(drawing.key)) {
      throw new AppError('BAD_REQUEST', `duplicate drawing key ${drawing.key}`);
    }
    drawingKeys.add(drawing.key);
  }
  const existingDrawings = await deps.db.unsafe<
    { id: string; style: Record<string, unknown> | string }[]
  >('SELECT id, style FROM drawings WHERE project_id = $1', [projectId]);
  const drawingByKey = new Map<string, string>();
  for (const row of existingDrawings) {
    const key = parseJsonColumn<Record<string, unknown>>(row.style, {}).applyKey;
    if (typeof key === 'string') drawingByKey.set(key, row.id);
  }
  const prunedDrawings = input.prune
    ? existingDrawings.filter((row) => {
        const key = parseJsonColumn<Record<string, unknown>>(row.style, {}).applyKey;
        return typeof key === 'string' && !drawingKeys.has(key);
      })
    : [];

  /* Privileges ------------------------------------------------------------ */
  const needed = new Set<Privilege>();
  for (const node of resolvedNodes) {
    if (!node.existing) needed.add('node.create');
    else if (node.fieldsChanged) needed.add('node.update');
    if (node.filesChanged) needed.add('node.files');
  }
  if (linkPlans.some((plan) => !plan.matched || plan.link.style)) needed.add('link.write');
  if (prunedLinks.length > 0) needed.add('link.write');
  if (prunedNodes.length > 0) needed.add('node.delete');
  if (input.drawings.length > 0 || prunedDrawings.length > 0) needed.add('drawing.write');
  if (input.start && resolvedNodes.length > 0) needed.add('node.control');
  for (const privilege of needed) requirePrivilegeFor(auth, privilege, scope);

  /* Nodes ----------------------------------------------------------------- */
  const nodeResults: ProjectApplyResult['nodes'] = [];
  const nodesByName = new Map<string, NodeRow>();

  for (const resolved of resolvedNodes) {
    const nodeInput = resolved.input;
    let node: NodeRow;
    let created = false;
    let updated = false;

    if (resolved.existing) {
      node = resolved.existing;
      if (resolved.fieldsChanged) {
        node = await updateNode(deps, userId, {
          id: node.id,
          ...(nodeInput.x !== undefined ? { x: nodeInput.x } : {}),
          ...(nodeInput.y !== undefined ? { y: nodeInput.y } : {}),
          ...(nodeInput.z !== undefined ? { z: nodeInput.z } : {}),
          ...(nodeInput.layer !== undefined ? { layer: nodeInput.layer } : {}),
          ...(nodeInput.symbol !== undefined ? { symbol: nodeInput.symbol } : {}),
          ...(nodeInput.locked !== undefined ? { locked: nodeInput.locked } : {}),
          ...(nodeInput.consoleAutoStart !== undefined
            ? { consoleAutoStart: nodeInput.consoleAutoStart }
            : {}),
          ...(nodeInput.properties !== undefined ? { properties: nodeInput.properties } : {}),
        });
        updated = true;
      }
    } else {
      node = await createNode(deps, userId, {
        projectId,
        ...(resolved.templateId
          ? { templateId: resolved.templateId }
          : { nodeType: resolved.nodeType }),
        ...(nodeInput.computeId ? { computeId: nodeInput.computeId } : {}),
        name: nodeInput.name,
        x: nodeInput.x ?? 0,
        y: nodeInput.y ?? 0,
        z: nodeInput.z ?? 0,
        layer: nodeInput.layer ?? 'default',
        ...(nodeInput.symbol !== undefined ? { symbol: nodeInput.symbol } : {}),
        ...(nodeInput.properties !== undefined ? { properties: nodeInput.properties } : {}),
      });
      created = true;
      if (nodeInput.locked === true || nodeInput.consoleAutoStart !== undefined) {
        node = await updateNode(deps, userId, {
          id: node.id,
          ...(nodeInput.locked === true ? { locked: true } : {}),
          ...(nodeInput.consoleAutoStart !== undefined
            ? { consoleAutoStart: nodeInput.consoleAutoStart }
            : {}),
        });
      }
    }

    if (nodeInput.files.length > 0) {
      for (const file of nodeInput.files) {
        await deps.agents.call(node.computeId, (agent) =>
          agent.nodeFiles.write({
            projectId,
            nodeId: node.id,
            path: file.path,
            content: file.content,
          }),
        );
      }
    }

    nodesByName.set(nodeInput.name, node);
    nodeResults.push({ name: nodeInput.name, id: node.id, status: node.status, created, updated });
  }

  /* Open the project before links so dataplane slots exist ----------------- */
  if (project.status !== 'opened') project = await openProject(deps, projectId);

  /* Links ----------------------------------------------------------------- */
  const linkResults: ProjectApplyResult['links'] = [];
  for (const plan of linkPlans) {
    if (plan.matched) {
      let updated = false;
      if (plan.link.style) {
        await updateLink(deps, userId, { id: plan.matched.id, style: plan.link.style });
        updated = true;
      }
      linkResults.push({
        id: plan.matched.id,
        a: plan.link.a,
        b: plan.link.b,
        created: false,
        updated,
      });
      continue;
    }
    const nodeA = nodesByName.get(plan.link.a);
    const nodeB = nodesByName.get(plan.link.b);
    if (!nodeA || !nodeB) {
      throw new AppError('INTERNAL', `link endpoints ${plan.link.a}/${plan.link.b} unresolved`);
    }
    const link = await createLink(deps, userId, {
      projectId,
      nodeAId: nodeA.id,
      adapterA: plan.a.adapter,
      portA: plan.a.port,
      nodeBId: nodeB.id,
      adapterB: plan.b.adapter,
      portB: plan.b.port,
      ...(plan.link.style ? { style: plan.link.style } : {}),
    });
    linkResults.push({
      id: link.id,
      a: plan.link.a,
      b: plan.link.b,
      created: true,
      updated: false,
    });
  }

  /* Drawings -------------------------------------------------------------- */
  const drawingResults: ProjectApplyResult['drawings'] = [];
  for (const drawing of input.drawings) {
    const existingId = drawingByKey.get(drawing.key);
    const style = { ...drawing.style, applyKey: drawing.key };
    const svg = drawing.svg ? sanitizeSvg(drawing.svg) : null;
    if (existingId) {
      await deps.db.unsafe(
        `UPDATE drawings SET
           type = $2, svg = $3, text = $4, file_path = $5,
           x = $6, y = $7, width = $8, height = $9, rotation = $10,
           z = $11, layer = $12, style = $13::jsonb
         WHERE id = $1`,
        [
          existingId,
          drawing.type,
          svg,
          drawing.text ?? null,
          drawing.filePath ?? null,
          drawing.x,
          drawing.y,
          drawing.width,
          drawing.height,
          drawing.rotation,
          drawing.z,
          drawing.layer,
          style,
        ],
      );
      await deps.events.publish({
        type: 'drawing.updated',
        projectId,
        payload: { drawingId: existingId },
      });
      drawingResults.push({
        id: existingId,
        key: drawing.key,
        created: false,
        updated: true,
      });
    } else {
      const id = newId();
      await deps.db.unsafe(
        `INSERT INTO drawings (id, project_id, type, svg, text, file_path, x, y, width, height,
                               rotation, z, layer, style)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
        [
          id,
          projectId,
          drawing.type,
          svg,
          drawing.text ?? null,
          drawing.filePath ?? null,
          drawing.x,
          drawing.y,
          drawing.width,
          drawing.height,
          drawing.rotation,
          drawing.z,
          drawing.layer,
          style,
        ],
      );
      await deps.events.publish({
        type: 'drawing.created',
        projectId,
        payload: { drawingId: id, type: drawing.type },
      });
      drawingResults.push({ id, key: drawing.key, created: true, updated: false });
    }
  }

  /* Prune ----------------------------------------------------------------- */
  const deletedLinkIds: string[] = [];
  for (const link of prunedLinks) {
    await deleteLink(deps, userId, link.id);
    deletedLinkIds.push(link.id);
  }
  const deletedNodeNames: string[] = [];
  for (const node of prunedNodes) {
    await deleteNode(deps, userId, node.id);
    deletedNodeNames.push(node.name);
  }
  const deletedDrawingIds: string[] = [];
  for (const row of prunedDrawings) {
    await deps.db.unsafe('DELETE FROM drawings WHERE id = $1', [row.id]);
    await deps.events.publish({
      type: 'drawing.deleted',
      projectId,
      payload: { drawingId: row.id },
    });
    deletedDrawingIds.push(row.id);
  }

  /* Start ----------------------------------------------------------------- */
  const started: string[] = [];
  if (input.start) {
    for (const resolved of resolvedNodes) {
      const node = nodesByName.get(resolved.input.name);
      if (!node || node.status === 'started') continue;
      await setNodePower(deps, userId, node.id, 'start');
      started.push(node.name);
    }
  }

  /* Result ---------------------------------------------------------------- */
  const finalProject = await getProject(deps.db, projectId);
  const finalStatus = new Map(
    (await listNodes(deps.db, projectId)).map((node) => [node.id, node.status] as const),
  );
  return {
    projectId,
    project: finalProject,
    nodes: nodeResults.map((node) => ({
      ...node,
      status: finalStatus.get(node.id) ?? node.status,
    })),
    links: linkResults,
    drawings: drawingResults,
    deleted: { nodes: deletedNodeNames, links: deletedLinkIds, drawings: deletedDrawingIds },
    started,
  };
}
