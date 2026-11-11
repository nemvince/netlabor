/** Dynamips adapter: per-project hypervisor, router VMs, NIO bindings. */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '@netlabor/contract';
import { closeConsole, openConsole } from '../console/proxy.ts';
import {
  type NodeAdapter,
  type NodeContext,
  type NodeStartResult,
  registerAdapter,
} from '../dataplane/node.ts';
import { startNodeProcess, stopProcess } from '../process.ts';
import type { ProjectRegistry } from '../state.ts';
import { HypervisorClient } from './dynamips-hypervisor.ts';

interface HypervisorRuntime {
  pid: number;
  port: number;
  client: HypervisorClient;
}

interface VmRuntime {
  name: string;
  pid: number | null;
  consolePort: number | null;
  idlepc: string | null;
}

const hypervisors = new WeakMap<ProjectRegistry, Map<string, HypervisorRuntime>>();
const vms = new WeakMap<ProjectRegistry, Map<string, VmRuntime>>();

function hypervisorMap(registry: ProjectRegistry): Map<string, HypervisorRuntime> {
  let map = hypervisors.get(registry);
  if (!map) {
    map = new Map();
    hypervisors.set(registry, map);
  }
  return map;
}

function vmMap(registry: ProjectRegistry): Map<string, VmRuntime> {
  let map = vms.get(registry);
  if (!map) {
    map = new Map();
    vms.set(registry, map);
  }
  return map;
}

function dynamipsBinary(): string {
  const found = Bun.which('dynamips');
  if (!found) throw new AppError('BINARY_MISSING', 'dynamips is not installed on this compute');
  return found;
}

/** Start or reuse the project's dynamips hypervisor inside the namespace. */
export async function ensureHypervisor(ctx: NodeContext): Promise<HypervisorRuntime> {
  const existing = hypervisorMap(ctx.registry).get(ctx.spec.projectId);
  if (existing) return existing;

  const binary = dynamipsBinary();
  const port = ctx.registry.allocateInternalPort(ctx.spec.projectId, 7200);
  // dynamips refuses to run as a non-root user (it exits silently), so the
  // per-project hypervisor runs as root inside the project namespace.
  const pid = await startNodeProcess({
    argv: [binary, '-H', String(port), '--idlemax', '1500', '--idlesleep', '30'],
    netns: ctx.netns,
    config: ctx.config,
    cwd: ctx.dir,
    uid: 0,
    gid: 0,
    keepStdinOpen: true,
    logFile: path.join(ctx.projectDir, 'logs', 'dynamips.log'),
  });
  const client = await HypervisorClient.connect(ctx.projectIp, port, 15_000);
  const runtime: HypervisorRuntime = { pid, port, client };
  hypervisorMap(ctx.registry).set(ctx.spec.projectId, runtime);
  return runtime;
}

/** Build the hypervisor command sequence for one router (exported for tests). */
export function buildVmCommands(input: {
  name: string;
  vmId: string;
  properties: Record<string, unknown>;
  imagePath: string;
  consolePort: number;
  auxPort: number | null;
  nvramPath: string;
  diskPath: string;
}): string[] {
  const properties = input.properties;
  const commands: string[] = [];
  commands.push(
    `vm create "${input.name}" ${input.vmId} ${String(properties.platform ?? 'c7200')}`,
  );
  commands.push(`vm set_ios "${input.name}" "${input.imagePath}"`);
  commands.push(`vm set_ram "${input.name}" ${Number(properties.ram ?? 256)}`);
  commands.push(`vm set_nvram "${input.name}" ${Number(properties.nvram ?? 128)}`);
  commands.push(`vm set_con_tcp_port "${input.name}" ${input.consolePort}`);
  if (input.auxPort !== null) commands.push(`vm set_aux_tcp_port "${input.name}" ${input.auxPort}`);
  commands.push(`vm set_ram_mmap "${input.name}" ${properties.mmap === false ? 0 : 1}`);
  commands.push(`vm set_sparse_mem "${input.name}" ${properties.sparsemem === true ? 1 : 0}`);
  if (typeof properties.npe === 'string' && properties.npe) {
    commands.push(`vm set_npe "${input.name}" ${properties.npe}`);
  }
  if (typeof properties.midplane === 'string' && properties.midplane) {
    commands.push(`vm set_midplane "${input.name}" ${properties.midplane}`);
  }
  commands.push(`vm set_config "${input.name}" "${input.nvramPath}" "${input.diskPath}"`);
  const slots = Array.isArray(properties.slots) ? (properties.slots as (string | null)[]) : [];
  slots.forEach((adapter, slot) => {
    if (adapter) commands.push(`vm slot_add_binding "${input.name}" ${slot} 0 ${adapter}`);
  });
  const wics = Array.isArray(properties.wics) ? (properties.wics as (string | null)[]) : [];
  wics.forEach((adapter, index) => {
    if (adapter) commands.push(`vm slot_add_binding "${input.name}" 0 ${index + 1} ${adapter}`);
  });
  commands.push(`vm start "${input.name}"`);
  return commands;
}

const dynamipsAdapter: NodeAdapter = {
  nodeType: 'dynamips',

  async create(ctx: NodeContext): Promise<void> {
    const imageId =
      typeof ctx.spec.properties.imageId === 'string' ? ctx.spec.properties.imageId : null;
    if (!imageId) throw new AppError('IMAGE_MISSING', 'Dynamips node has no IOS image');
    if (!ctx.spec.images[imageId]) {
      throw new AppError('IMAGE_MISSING', 'IOS image is not present on this compute', {
        details: { imageId },
      });
    }
    const startup = ctx.spec.properties.startupConfig;
    if (typeof startup === 'string' && startup.length > 0) {
      await writeFile(path.join(ctx.dir, 'startup-config'), startup, { mode: 0o644 });
    }
  },

  async start(ctx: NodeContext): Promise<NodeStartResult> {
    const imageId =
      typeof ctx.spec.properties.imageId === 'string' ? ctx.spec.properties.imageId : null;
    const imagePath = imageId ? ctx.spec.images[imageId] : undefined;
    if (!imagePath) throw new AppError('IMAGE_MISSING', 'IOS image is not present on this compute');

    const hypervisor = await ensureHypervisor(ctx);
    const consolePort = ctx.registry.allocateInternalPort(ctx.spec.projectId, 20000);
    const auxPort = ctx.spec.console.auxExternalPort
      ? ctx.registry.allocateInternalPort(ctx.spec.projectId, 21000)
      : null;
    const nvramPath = path.join(ctx.dir, 'nvram');
    const diskPath = path.join(ctx.dir, 'disk0');

    const commands = buildVmCommands({
      name: ctx.spec.name,
      vmId: ctx.spec.nodeId.replaceAll('-', '').slice(0, 12),
      properties: ctx.spec.properties,
      imagePath,
      consolePort,
      auxPort,
      nvramPath,
      diskPath,
    });
    for (const command of commands) {
      await hypervisor.client.send(command);
    }

    if (ctx.spec.console.externalPort !== null && ctx.spec.console.type === 'telnet') {
      await openConsole({
        nodeId: ctx.spec.nodeId,
        externalPort: ctx.spec.console.externalPort,
        projectIp: ctx.projectIp,
        internalPort: consolePort,
        telnet: true,
      });
    }

    const status = await hypervisor.client
      .send(`vm get_status "${ctx.spec.name}"`)
      .catch(() => ['']);
    void status;
    vmMap(ctx.registry).set(ctx.spec.nodeId, {
      name: ctx.spec.name,
      pid: hypervisor.pid,
      consolePort,
      idlepc: typeof ctx.spec.properties.idlepc === 'string' ? ctx.spec.properties.idlepc : null,
    });
    return {
      pid: hypervisor.pid,
      internalConsolePort: consolePort,
      internalVncPort: null,
      extra: { vmName: ctx.spec.name },
    };
  },

  async stop(ctx: NodeContext): Promise<void> {
    await closeConsole(ctx.spec.nodeId);
    const state = vmMap(ctx.registry).get(ctx.spec.nodeId);
    const hypervisor = hypervisorMap(ctx.registry).get(ctx.spec.projectId);
    if (hypervisor && state) {
      await hypervisor.client.send(`vm stop "${state.name}"`).catch(() => undefined);
      await hypervisor.client.send(`vm delete "${state.name}"`).catch(() => undefined);
    }
    vmMap(ctx.registry).delete(ctx.spec.nodeId);
    if (hypervisor && vmMap(ctx.registry).size === 0) {
      hypervisor.client.close();
      await stopProcess(hypervisor.pid, 5_000);
      hypervisorMap(ctx.registry).delete(ctx.spec.projectId);
    }
  },

  async suspend(ctx: NodeContext): Promise<void> {
    const hypervisor = hypervisorMap(ctx.registry).get(ctx.spec.projectId);
    const state = vmMap(ctx.registry).get(ctx.spec.nodeId);
    if (!hypervisor || !state) throw new AppError('NODE_NOT_RUNNING', 'node is not running');
    await hypervisor.client.send(`vm stop "${state.name}"`);
  },

  async delete(ctx: NodeContext): Promise<void> {
    await closeConsole(ctx.spec.nodeId);
  },
};

/** Bind (or rebind) a UDP NIO for a router port. */
export async function addDynamipsNio(
  registry: ProjectRegistry,
  projectId: string,
  nodeName: string,
  adapter: number,
  port: number,
  lport: number,
  rhost: string,
  rport: number,
): Promise<void> {
  const hypervisor = hypervisors.get(registry)?.get(projectId);
  if (!hypervisor) throw new AppError('NODE_NOT_RUNNING', 'dynamips hypervisor is not running');
  await hypervisor.client.send(
    `vm slot_add_nio_binding "${nodeName}" ${adapter} ${port} nio_udp:${lport}:${rhost}:${rport}`,
  );
}

export async function idlepcProposals(
  registry: ProjectRegistry,
  projectId: string,
  vmName: string,
): Promise<{ idlepc: string; score: number; description?: string }[]> {
  const hypervisor = hypervisors.get(registry)?.get(projectId);
  if (!hypervisor) throw new AppError('NODE_NOT_RUNNING', 'dynamips hypervisor is not running');
  const lines = await hypervisor.client.send(`vm show_idle_pc_prop "${vmName}"`);
  return lines
    .map((line) => /0x[0-9a-fA-F]+/.exec(line)?.[0])
    .filter((value): value is string => value !== undefined)
    .map((idlepc) => ({ idlepc, score: 1, description: 'reported by hypervisor' }));
}

export async function setIdlepc(
  registry: ProjectRegistry,
  projectId: string,
  vmName: string,
  idlepc: string,
): Promise<void> {
  const hypervisor = hypervisors.get(registry)?.get(projectId);
  if (!hypervisor) throw new AppError('NODE_NOT_RUNNING', 'dynamips hypervisor is not running');
  await hypervisor.client.send(`vm set_idle_pc_online "${vmName}" ${idlepc}`);
}

export function registerDynamipsAdapter(): void {
  registerAdapter(dynamipsAdapter);
}

export function dynamipsRuntimeFor(
  registry: ProjectRegistry,
  nodeId: string,
): VmRuntime | undefined {
  return vmMap(registry).get(nodeId);
}

/**
 * Propose idle-PC values by running the IOS image under a temporary hypervisor
 * in the host namespace. Without a usable image this fails with IMAGE_MISSING.
 */
export async function idlepcProposalsForImage(options: {
  imagePath: string;
  platform: string;
  count: number;
  runDir: string;
}): Promise<{ idlepc: string; score: number; description?: string }[]> {
  if (!(await Bun.file(options.imagePath).exists())) {
    throw new AppError('IMAGE_MISSING', 'IOS image is not present on this compute');
  }
  const binary = dynamipsBinary();
  const port = 7200 + Math.floor(Math.random() * 200);
  // Dynamips writes its instance logs and JIT caches into the working
  // directory; keep them out of whatever directory the agent was started from.
  const workDir = path.join(options.runDir, 'dynamips-idlepc');
  await mkdir(workDir, { recursive: true, mode: 0o700 });
  const proc = Bun.spawn([binary, '-H', String(port)], {
    cwd: workDir,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  try {
    const client = await HypervisorClient.connect('127.0.0.1', port, 15_000);
    try {
      const vmName = 'idlepc-probe';
      const vmId = `probe${Date.now().toString(36)}`;
      await client.send(`vm create "${vmName}" ${vmId} ${options.platform}`);
      await client.send(`vm set_ios "${vmName}" "${options.imagePath}"`);
      await client.send(`vm set_ram "${vmName}" 256`);
      await client.send(`vm set_nvram "${vmName}" 128`);
      await client.send(`vm set_con_tcp_port "${vmName}" ${port + 1}`);
      await client.send(`vm start "${vmName}"`);
      const lines = await client.send(`vm show_idle_pc_prop "${vmName}"`, 120_000);
      const proposals = lines
        .map((line) => {
          const match = /(0x[0-9a-fA-F]+)\s+([\d.]+)/.exec(line);
          if (match?.[1]) return { idlepc: match[1], score: Number(match[2] ?? 1) };
          const bare = /0x[0-9a-fA-F]+/.exec(line);
          return bare ? { idlepc: bare[0], score: 1 } : null;
        })
        .filter((entry): entry is { idlepc: string; score: number } => entry !== null);
      await client.send(`vm stop "${vmName}"`).catch(() => undefined);
      await client.send(`vm delete "${vmName}"`).catch(() => undefined);
      return proposals
        .sort((a, b) => b.score - a.score)
        .slice(0, options.count)
        .map((proposal) => ({ ...proposal, description: 'idle-PC candidate from hypervisor' }));
    } finally {
      client.close();
    }
  } finally {
    await stopProcess(proc.pid, 5_000);
  }
}
