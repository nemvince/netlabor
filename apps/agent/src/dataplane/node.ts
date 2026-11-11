/** Node lifecycle: working directories and emulator start/stop dispatch. */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type AgentNodeSpec, type AgentNodeStatus, AppError } from '@netlabor/contract';
import type { AgentConfig } from '../config.ts';
import type { ProjectRegistry } from '../state.ts';
import { chownForEmulator } from '../sys.ts';
import { nodeDir } from './project.ts';

export interface NodeStartResult {
  pid: number | null;
  internalConsolePort: number | null;
  internalVncPort: number | null;
  extra?: Record<string, string>;
}

export interface NodeAdapter {
  readonly nodeType: string;
  /** Prepare files and validate configuration. */
  create(ctx: NodeContext): Promise<void>;
  start(ctx: NodeContext): Promise<NodeStartResult>;
  stop(ctx: NodeContext): Promise<void>;
  suspend?(ctx: NodeContext): Promise<void>;
  delete?(ctx: NodeContext): Promise<void>;
}

export interface NodeContext {
  config: AgentConfig;
  registry: ProjectRegistry;
  spec: AgentNodeSpec;
  dir: string;
  projectDir: string;
  netns: string;
  projectIp: string;
}

const adapters = new Map<string, NodeAdapter>();

export function registerAdapter(adapter: NodeAdapter): void {
  adapters.set(adapter.nodeType, adapter);
}

export function adapterFor(nodeType: string): NodeAdapter | null {
  return adapters.get(nodeType) ?? null;
}

export async function prepareNodeDirectory(ctx: NodeContext): Promise<void> {
  await mkdir(ctx.dir, { recursive: true, mode: 0o755 });
  await chownForEmulator(ctx.dir, ctx.config.emulatorUid, ctx.config.emulatorGid);
}

export async function writeNodeMeta(ctx: NodeContext): Promise<void> {
  const meta = {
    nodeId: ctx.spec.nodeId,
    projectId: ctx.spec.projectId,
    computeId: ctx.spec.computeId,
    name: ctx.spec.name,
    nodeType: ctx.spec.nodeType,
    templateId: ctx.spec.templateId,
    properties: ctx.spec.properties,
    ports: ctx.spec.ports,
    console: ctx.spec.console,
    applicationId: ctx.spec.applicationId,
    images: ctx.spec.images,
  };
  await writeFile(path.join(ctx.dir, 'meta.json'), JSON.stringify(meta, null, 2), { mode: 0o644 });
}

export async function createNode(
  config: AgentConfig,
  registry: ProjectRegistry,
  spec: AgentNodeSpec,
): Promise<AgentNodeStatus> {
  const project = registry.get(spec.projectId);
  if (!project)
    throw new AppError('NODE_NOT_RUNNING', 'project namespace is not open on this compute');
  const dir = nodeDir(config, spec.projectId, spec.nodeId);
  const ctx: NodeContext = {
    config,
    registry,
    spec,
    dir,
    projectDir: path.dirname(path.dirname(dir)),
    netns: project.netns,
    projectIp: project.projectIp,
  };
  await prepareNodeDirectory(ctx);
  const adapter = adapterFor(spec.nodeType);
  if (adapter) await adapter.create(ctx);
  await writeNodeMeta(ctx);
  registry.trackNode(spec.projectId, {
    nodeId: spec.nodeId,
    projectId: spec.projectId,
    nodeType: spec.nodeType,
    status: 'stopped',
    pid: null,
    internalConsolePort: null,
    internalVncPort: null,
    message: null,
    extra: {},
  });
  return {
    nodeId: spec.nodeId,
    status: 'stopped',
    pid: null,
    internalConsolePort: null,
    internalVncPort: null,
    message: null,
  };
}

function contextFor(
  config: AgentConfig,
  registry: ProjectRegistry,
  spec: AgentNodeSpec,
): NodeContext {
  const project = registry.get(spec.projectId);
  const dir = nodeDir(config, spec.projectId, spec.nodeId);
  return {
    config,
    registry,
    spec,
    dir,
    projectDir: path.dirname(path.dirname(dir)),
    netns: project?.netns ?? '',
    projectIp: project?.projectIp ?? '',
  };
}

export async function startNode(
  config: AgentConfig,
  registry: ProjectRegistry,
  spec: AgentNodeSpec,
  onConsole?: (nodeId: string, internalPort: number) => void,
): Promise<AgentNodeStatus> {
  const adapter = adapterFor(spec.nodeType);
  if (!adapter)
    throw new AppError(
      'CAPABILITY_UNSUPPORTED',
      `${spec.nodeType} nodes are not supported by this agent`,
    );
  const ctx = contextFor(config, registry, spec);
  const existing = registry.node(spec.nodeId);
  if (existing?.status === 'started') {
    return {
      nodeId: spec.nodeId,
      status: 'started',
      pid: existing.pid,
      internalConsolePort: existing.internalConsolePort,
      internalVncPort: existing.internalVncPort,
      message: null,
    };
  }
  await prepareNodeDirectory(ctx);
  const result = await adapter.start(ctx);
  registry.trackNode(spec.projectId, {
    nodeId: spec.nodeId,
    projectId: spec.projectId,
    nodeType: spec.nodeType,
    status: 'started',
    pid: result.pid,
    internalConsolePort: result.internalConsolePort,
    internalVncPort: result.internalVncPort,
    message: null,
    extra: result.extra ?? {},
  });
  if (result.internalConsolePort !== null) onConsole?.(spec.nodeId, result.internalConsolePort);
  return {
    nodeId: spec.nodeId,
    status: 'started',
    pid: result.pid,
    internalConsolePort: result.internalConsolePort,
    internalVncPort: result.internalVncPort,
    message: null,
  };
}

export async function stopNode(
  config: AgentConfig,
  registry: ProjectRegistry,
  spec: AgentNodeSpec,
): Promise<AgentNodeStatus> {
  const adapter = adapterFor(spec.nodeType);
  const ctx = contextFor(config, registry, spec);
  if (adapter) await adapter.stop(ctx);
  const node = registry.node(spec.nodeId);
  registry.trackNode(spec.projectId, {
    nodeId: spec.nodeId,
    projectId: spec.projectId,
    nodeType: spec.nodeType,
    status: 'stopped',
    pid: null,
    internalConsolePort: node?.internalConsolePort ?? null,
    internalVncPort: node?.internalVncPort ?? null,
    message: null,
    extra: node?.extra ?? {},
  });
  return {
    nodeId: spec.nodeId,
    status: 'stopped',
    pid: null,
    internalConsolePort: null,
    internalVncPort: null,
    message: null,
  };
}

export async function suspendNode(
  config: AgentConfig,
  registry: ProjectRegistry,
  spec: AgentNodeSpec,
): Promise<AgentNodeStatus> {
  const adapter = adapterFor(spec.nodeType);
  if (!adapter?.suspend) {
    throw new AppError('CAPABILITY_UNSUPPORTED', `${spec.nodeType} nodes cannot be suspended`);
  }
  await adapter.suspend(contextFor(config, registry, spec));
  const node = registry.node(spec.nodeId);
  if (node) node.status = 'suspended';
  return {
    nodeId: spec.nodeId,
    status: 'suspended',
    pid: node?.pid ?? null,
    internalConsolePort: node?.internalConsolePort ?? null,
    internalVncPort: node?.internalVncPort ?? null,
    message: null,
  };
}

/** Rebuild a node spec from its persisted meta.json. */
export async function readNodeSpec(
  config: AgentConfig,
  projectId: string,
  nodeId: string,
): Promise<AgentNodeSpec | null> {
  try {
    const text = await Bun.file(path.join(nodeDir(config, projectId, nodeId), 'meta.json')).text();
    return JSON.parse(text) as AgentNodeSpec;
  } catch {
    return null;
  }
}

export async function deleteNode(
  config: AgentConfig,
  registry: ProjectRegistry,
  projectId: string,
  nodeId: string,
): Promise<void> {
  const spec = await readNodeSpec(config, projectId, nodeId);
  if (spec) await stopNode(config, registry, spec).catch(() => undefined);
  const dir = nodeDir(config, projectId, nodeId);
  await rm(dir, { recursive: true, force: true });
  registry.untrackNode(projectId, nodeId);
}
