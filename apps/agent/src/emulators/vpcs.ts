/** VPCS adapter: process lifecycle, startup script, and UDP link bindings. */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '@netlabor/contract';
import { closeConsole, openConsole } from '../console/proxy.ts';
import {
  type NodeAdapter,
  type NodeContext,
  type NodeStartResult,
  readNodeSpec,
  registerAdapter,
} from '../dataplane/node.ts';
import { nodeDir, projectDir } from '../dataplane/project.ts';
import { startNodeProcess, stopProcess } from '../process.ts';
import type { ProjectRegistry } from '../state.ts';

interface VpcsRuntime {
  pid: number;
  internalPort: number;
  macId: number;
  udp: string | null;
}

const runtime = new WeakMap<ProjectRegistry, Map<string, VpcsRuntime>>();
const macCounters = new WeakMap<ProjectRegistry, Map<string, number>>();

function runtimes(registry: ProjectRegistry): Map<string, VpcsRuntime> {
  let map = runtime.get(registry);
  if (!map) {
    map = new Map();
    runtime.set(registry, map);
  }
  return map;
}

function nextMacId(registry: ProjectRegistry, projectId: string): number {
  let map = macCounters.get(registry);
  if (!map) {
    map = new Map();
    macCounters.set(registry, map);
  }
  const next = (map.get(projectId) ?? 0) + 1;
  map.set(projectId, next);
  return next;
}

function vpcsBinary(): string {
  const binary = Bun.which('vpcs');
  if (!binary) throw new AppError('BINARY_MISSING', 'vpcs is not installed on this compute');
  return binary;
}

function vpcsArgs(internalPort: number, macId: number, udp: string | null): string[] {
  const args = ['-p', String(internalPort), '-m', String(macId), '-i', '1', '-F', '-R'];
  if (udp) {
    const [local, remote, host] = udp.split(':');
    if (local && remote && host) args.push('-s', local, '-c', remote, '-t', host);
  }
  return args;
}

/** UDP binding for a VPCS port: `local:remote:host` as vpcs -s/-c/-t. */
function nodeUdp(registry: ProjectRegistry, nodeId: string): string | null {
  const udp = registry.node(nodeId)?.extra.udp;
  return udp && udp.length > 0 ? udp : null;
}

async function spawnVpcs(
  ctx: NodeContext,
  udp: string | null,
  reuse?: { internalPort: number; macId: number },
): Promise<VpcsRuntime> {
  // A restart must keep the console port and MAC: the agent registry and the
  // external console listener still point at them.
  const internalPort =
    reuse?.internalPort ?? ctx.registry.allocateInternalPort(ctx.spec.projectId, 3000);
  const configuredMac = Number(ctx.spec.properties.macId ?? 0);
  const macId =
    Number.isInteger(configuredMac) && configuredMac > 0
      ? configuredMac
      : (reuse?.macId ?? nextMacId(ctx.registry, ctx.spec.projectId));
  const binary = vpcsBinary();
  const args = vpcsArgs(internalPort, macId, udp);
  const pid = await startNodeProcess({
    argv: [binary, ...args],
    netns: ctx.netns,
    config: ctx.config,
    cwd: ctx.dir,
    logFile: path.join(ctx.projectDir, 'logs', `${ctx.spec.nodeId}.log`),
  });
  if (ctx.spec.console.externalPort !== null && ctx.spec.console.type === 'telnet') {
    await openConsole({
      nodeId: ctx.spec.nodeId,
      externalPort: ctx.spec.console.externalPort,
      projectIp: ctx.projectIp,
      internalPort,
      telnet: true,
    });
  }
  return { pid, internalPort, macId, udp };
}

const vpcsAdapter: NodeAdapter = {
  nodeType: 'vpcs',

  async create(ctx: NodeContext): Promise<void> {
    const script = ctx.spec.properties.startupScript;
    if (typeof script === 'string' && script.length > 0) {
      await writeFile(path.join(ctx.dir, 'startup.vpc'), script, { mode: 0o644 });
    }
  },

  async start(ctx: NodeContext): Promise<NodeStartResult> {
    const running = runtimes(ctx.registry).get(ctx.spec.nodeId);
    if (running) {
      await stopProcess(running.pid);
      await closeConsole(ctx.spec.nodeId);
    }
    const runtimeState = await spawnVpcs(ctx, nodeUdp(ctx.registry, ctx.spec.nodeId));
    runtimes(ctx.registry).set(ctx.spec.nodeId, runtimeState);
    return {
      pid: runtimeState.pid,
      internalConsolePort: runtimeState.internalPort,
      internalVncPort: null,
      extra: { udp: runtimeState.udp ?? '' },
    };
  },

  async stop(ctx: NodeContext): Promise<void> {
    const running = runtimes(ctx.registry).get(ctx.spec.nodeId);
    if (running) {
      await stopProcess(running.pid);
      runtimes(ctx.registry).delete(ctx.spec.nodeId);
    }
    await closeConsole(ctx.spec.nodeId);
  },

  async delete(ctx: NodeContext): Promise<void> {
    await closeConsole(ctx.spec.nodeId);
  },
};

/**
 * Apply a VPCS UDP binding. VPCS cannot reconfigure its UDP socket at runtime,
 * so a running process is restarted only when the binding actually changes.
 * The console port and MAC are kept stable across restarts.
 */
export async function setVpcsUdp(
  config: NodeContext['config'],
  registry: ProjectRegistry,
  projectId: string,
  nodeId: string,
  udp: string | null,
): Promise<void> {
  const binding = udp ?? '';
  const node = registry.node(nodeId);
  if (node) node.extra.udp = binding;
  const running = runtimes(registry).get(nodeId);
  if (!running) return;
  if ((running.udp ?? '') === binding) return;

  const project = registry.get(projectId);
  if (!project) throw new AppError('NODE_NOT_RUNNING', 'project namespace is not open');
  const nodeSpec = await readNodeSpec(config, projectId, nodeId);
  if (!nodeSpec) throw new AppError('AGENT_ERROR', `node ${nodeId} has no persisted spec`);

  await stopProcess(running.pid);
  await closeConsole(nodeId);
  const dir = nodeDir(config, projectId, nodeId);
  const runtimeState = await spawnVpcs(
    {
      config,
      registry,
      spec: nodeSpec,
      dir,
      projectDir: projectDir(config, projectId),
      netns: project.netns,
      projectIp: project.projectIp,
    },
    binding.length > 0 ? binding : null,
    { internalPort: running.internalPort, macId: running.macId },
  );
  runtimes(registry).set(nodeId, runtimeState);
  // execConsole and resetConsole read the port from the registry.
  const tracked = registry.node(nodeId);
  if (tracked) {
    tracked.pid = runtimeState.pid;
    tracked.internalConsolePort = runtimeState.internalPort;
    tracked.extra.udp = binding;
  }
}

export function registerVpcsAdapter(): void {
  registerAdapter(vpcsAdapter);
}

export function vpcsRuntimeFor(registry: ProjectRegistry, nodeId: string): VpcsRuntime | undefined {
  return runtimes(registry).get(nodeId);
}
