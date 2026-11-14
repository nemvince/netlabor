/** QEMU adapter: argument builder, qcow2 overlays, QMP lifecycle, consoles. */

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { anchorHash } from '@netlabor/catalog/anchors';
import { AppError } from '@netlabor/contract';
import type { AgentConfig } from '../config.ts';
import { closeConsole, openConsole } from '../console/proxy.ts';
import { openSerialConsole } from '../console/serial.ts';
import {
  type NodeAdapter,
  type NodeContext,
  type NodeStartResult,
  readNodeSpec,
  registerAdapter,
} from '../dataplane/node.ts';
import { ubridgeClientFor } from '../dataplane/project.ts';
import { startNodeProcess, stopProcess } from '../process.ts';
import type { ProjectRegistry } from '../state.ts';
import { chownForEmulator } from '../sys.ts';
import { prepareCloudInit } from './cloud-init.ts';
import { QmpClient } from './qemu-qmp.ts';

interface QemuRuntime {
  pid: number;
  internalConsolePort: number | null;
  internalVncPort: number | null;
  qmpSocket: string;
  suspended: boolean;
  vncDisplay: number | null;
}

const runtime = new WeakMap<ProjectRegistry, Map<string, QemuRuntime>>();
const kvmSupport = new Map<string, boolean>();

function runtimes(registry: ProjectRegistry): Map<string, QemuRuntime> {
  let map = runtime.get(registry);
  if (!map) {
    map = new Map();
    runtime.set(registry, map);
  }
  return map;
}

function qemuBinary(properties: Record<string, unknown>): string {
  const configured = typeof properties.qemuPath === 'string' ? properties.qemuPath : null;
  const candidates = [configured, 'qemu-system-x86_64', 'qemu-system-aarch64'].filter(
    (entry): entry is string => typeof entry === 'string' && entry.length > 0,
  );
  for (const candidate of candidates) {
    const found = Bun.which(candidate);
    if (found) return found;
  }
  throw new AppError('BINARY_MISSING', 'no qemu-system binary found on this compute');
}

async function hasKvm(binary: string): Promise<boolean> {
  const cached = kvmSupport.get(binary);
  if (cached !== undefined) return cached;
  let supported = false;
  try {
    const proc = Bun.spawn([binary, '-accel', 'help'], { stdout: 'pipe', stderr: 'pipe' });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    supported = /\bkvm\b/.test(text) && existsSync('/dev/kvm');
  } catch {
    supported = false;
  }
  kvmSupport.set(binary, supported);
  return supported;
}

interface DiskSpec {
  key: string;
  imagePath: string;
  interface: string;
  format: string;
  linked: boolean;
  sizeBytes?: number;
}

function diskSpecs(ctx: NodeContext): DiskSpec[] {
  const properties = ctx.spec.properties;
  const disks = (properties.disks ?? {}) as Record<
    string,
    { imageId?: string; interface?: string; format?: string; sizeBytes?: number }
  >;
  const linked = properties.linkedClone !== false;
  const specs: DiskSpec[] = [];
  for (const key of ['hda', 'hdb', 'hdc', 'hdd']) {
    const disk = disks[key];
    const imageId = disk?.imageId;
    if (!imageId) continue;
    const basePath = ctx.spec.images[imageId];
    if (!basePath) {
      throw new AppError('IMAGE_MISSING', `disk image ${imageId} is not present on this compute`, {
        details: { imageId, disk: key },
      });
    }
    specs.push({
      key,
      imagePath: basePath,
      interface: disk?.interface ?? 'ide',
      format: disk?.format ?? 'qcow2',
      linked,
      ...(typeof disk?.sizeBytes === 'number' && disk.sizeBytes > 0
        ? { sizeBytes: disk.sizeBytes }
        : {}),
    });
  }
  return specs;
}

async function prepareDisks(ctx: NodeContext): Promise<DiskSpec[]> {
  const specs = diskSpecs(ctx);
  for (const disk of specs) {
    const target = path.join(ctx.dir, `${disk.key}.qcow2`);
    if (disk.linked) {
      if (!(await Bun.file(target).exists())) {
        const args = ['qemu-img', 'create', '-f', 'qcow2', '-F', disk.format, '-b', disk.imagePath];
        args.push(target);
        if (disk.sizeBytes) args.push(String(disk.sizeBytes));
        const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
        const stderr = await new Response(proc.stderr).text();
        if ((await proc.exited) !== 0) {
          throw new AppError('AGENT_ERROR', `failed to create overlay for ${disk.key}`, {
            details: stderr.trim(),
          });
        }
        await chownForEmulator(target, ctx.config.emulatorUid, ctx.config.emulatorGid);
      }
      disk.imagePath = target;
    } else if (!(await Bun.file(target).exists())) {
      await copyFile(disk.imagePath, target);
      await chownForEmulator(target, ctx.config.emulatorUid, ctx.config.emulatorGid);
      disk.imagePath = target;
    } else {
      disk.imagePath = target;
    }
  }
  return specs;
}

/** Build the QEMU argv for a node. Exposed for argument-builder tests. */
export async function buildQemuArgs(
  ctx: NodeContext,
  disks: DiskSpec[],
  vncDisplay?: number,
  cloudInitIso?: string,
): Promise<string[]> {
  const properties = ctx.spec.properties;
  const binary = qemuBinary(properties);
  const args: string[] = [
    '-name',
    ctx.spec.name,
    '-m',
    String(Number(properties.ram ?? 256)),
    '-smp',
    String(Number(properties.cpus ?? 1)),
  ];
  if (typeof properties.machineType === 'string' && properties.machineType)
    args.push('-machine', properties.machineType);
  if (typeof properties.cpuModel === 'string' && properties.cpuModel)
    args.push('-cpu', properties.cpuModel);
  if (await hasKvm(binary)) args.push('-enable-kvm');

  const bootPriority = typeof properties.bootPriority === 'string' ? properties.bootPriority : 'c';
  const bootIndex: Record<string, string> = { c: 'c', d: 'd', n: 'n' };
  args.push('-boot', [...bootPriority].map((letter) => bootIndex[letter] ?? 'c').join(''));

  for (const disk of disks) {
    const drive = `file=${disk.imagePath},if=${disk.interface},format=qcow2${disk.key === 'hda' ? ',index=0' : ''}`;
    args.push('-drive', drive);
  }

  const cdromId = typeof properties.cdromImageId === 'string' ? properties.cdromImageId : null;
  if (cdromId) {
    const iso = ctx.spec.images[cdromId];
    if (!iso) throw new AppError('IMAGE_MISSING', 'cdrom image is not present on this compute');
    args.push('-drive', `file=${iso},media=cdrom,readonly=on`);
  }
  if (cloudInitIso) {
    args.push('-drive', `file=${cloudInitIso},media=cdrom,readonly=on`);
  }

  const adapters = Number(properties.adapters ?? 1);
  const adapterType = typeof properties.adapterType === 'string' ? properties.adapterType : 'e1000';
  const macBase = typeof properties.macAddress === 'string' ? properties.macAddress : null;
  for (const port of ctx.spec.ports) {
    if (port.laneType !== 'ethernet') continue;
    const hash = anchorHash(ctx.spec.nodeId, port.adapter, port.port);
    const tap = `t${hash}`;
    const client = ubridgeClientFor(ctx.registry, ctx.spec.projectId);
    if (!client) throw new AppError('AGENT_ERROR', 'project ubridge is not running');
    await client.send(`tap delete ${tap}`).catch(() => undefined);
    await client.send(`tap create ${tap}`).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('already exists') && !message.includes('busy')) throw error;
    });
    await client.send(`tap set_owner ${tap} ${ctx.config.emulatorUid}`).catch(() => undefined);
    const mac = macBase
      ? macFromBase(macBase, port.adapter)
      : defaultMac(ctx.spec.nodeId, port.adapter);
    args.push('-netdev', `tap,id=net${port.adapter},ifname=${tap},script=no,downscript=no`);
    args.push('-device', `${adapterType},netdev=net${port.adapter},mac=${mac}`);
  }
  void adapters;

  const consoleType =
    typeof properties.consoleType === 'string' ? properties.consoleType : 'telnet';
  const internalConsole = ctx.registry.allocateInternalPort(ctx.spec.projectId, 3000);
  if (consoleType === 'telnet') {
    args.push('-serial', `tcp:${ctx.projectIp}:${internalConsole},server,nowait`);
  } else if (consoleType === 'vnc') {
    if (vncDisplay === undefined) {
      throw new AppError('AGENT_ERROR', 'VNC console requires a display number');
    }
    args.push('-vnc', `${ctx.projectIp}:${vncDisplay}`);
    // VNC pointer events need an absolute pointing device; PS/2 AUX is not
    // present on all Q35 guests, so expose a virtio tablet.
    args.push('-device', 'virtio-tablet-pci');
    args.push('-serial', 'none');
  }

  // UNIX socket paths are capped at 108 bytes; keep QMP out of the node path.
  const qmpSocket = qmpPath(ctx.config, ctx.spec.nodeId);
  // The run dir can be recreated under a running agent (tmpfiles, manual
  // cleanup); QEMU cannot create its socket without this directory and owner.
  await mkdir(path.dirname(qmpSocket), { recursive: true, mode: 0o750 });
  await chownForEmulator(path.dirname(qmpSocket), ctx.config.emulatorUid, ctx.config.emulatorGid);
  await rm(qmpSocket, { force: true });
  args.push('-qmp', `unix:${qmpSocket},server,nowait`);
  args.push('-display', 'none');
  args.push('-pidfile', path.join(ctx.dir, 'qemu.pid'));

  const kernelId = typeof properties.kernelImageId === 'string' ? properties.kernelImageId : null;
  if (kernelId) {
    const kernelPath = ctx.spec.images[kernelId];
    if (!kernelPath)
      throw new AppError('IMAGE_MISSING', 'kernel image is not present on this compute');
    args.push('-kernel', kernelPath);
    const initrdId = typeof properties.initrdImageId === 'string' ? properties.initrdImageId : null;
    if (initrdId) {
      const initrdPath = ctx.spec.images[initrdId];
      if (initrdPath) args.push('-initrd', initrdPath);
    }
    if (typeof properties.kernelCommandLine === 'string' && properties.kernelCommandLine) {
      args.push('-append', properties.kernelCommandLine);
    }
  }

  const options = Array.isArray(properties.options) ? (properties.options as string[]) : [];
  args.push(...options);
  return args;
}

/**
 * Keep the adapter number in the last octet, matching GNS3's QEMU MACs. Tools
 * that map a renamed guest NIC (VyOS eth1/eth2/...) back to an adapter read
 * that octet; a random last byte would leave them unable to build a config.
 */
export function defaultMac(nodeId: string, adapter: number): string {
  const hash = anchorHash(nodeId, adapter, 0);
  return `52:54:${hash.slice(0, 2)}:${hash.slice(2, 4)}:${hash.slice(4, 6)}:${adapter
    .toString(16)
    .padStart(2, '0')}`;
}

function macFromBase(base: string, index: number): string {
  const cleaned = base
    .replace(/[^0-9a-fA-F]/g, '')
    .padEnd(12, '0')
    .slice(0, 12);
  const lastByte = (Number.parseInt(cleaned.slice(10, 12), 16) + index) % 256;
  return `${cleaned.slice(0, 10)}${lastByte.toString(16).padStart(2, '0')}`;
}

const qemuAdapter: NodeAdapter = {
  nodeType: 'qemu',

  async create(ctx: NodeContext): Promise<void> {
    await mkdir(ctx.dir, { recursive: true, mode: 0o755 });
  },

  async start(ctx: NodeContext): Promise<NodeStartResult> {
    const disks = await prepareDisks(ctx);
    const consoleType =
      typeof ctx.spec.properties.consoleType === 'string'
        ? ctx.spec.properties.consoleType
        : 'telnet';
    const vncDisplay =
      consoleType === 'vnc' ? ctx.registry.allocateVncDisplay(ctx.spec.projectId) : undefined;
    const cloudInitIso =
      ctx.spec.properties.cloudInitEnabled === true ? await prepareCloudInit(ctx) : undefined;
    const args = await buildQemuArgs(ctx, disks, vncDisplay, cloudInitIso);
    const binary = qemuBinary(ctx.spec.properties);
    const pid = await startNodeProcess({
      argv: [binary, ...args],
      netns: ctx.netns,
      config: ctx.config,
      cwd: ctx.dir,
      uid: ctx.config.emulatorUid,
      gid: ctx.config.emulatorGid,
      logFile: path.join(ctx.projectDir, 'logs', `${ctx.spec.nodeId}.log`),
    });

    const qmpSocket = qmpPath(ctx.config, ctx.spec.nodeId);
    const logFile = path.join(ctx.projectDir, 'logs', `${ctx.spec.nodeId}.log`);
    try {
      const qmp = await QmpClient.connect(qmpSocket, 10_000);
      qmp.close();
    } catch (error) {
      // A dead QEMU only shows as a missing socket; the log says why it died.
      await stopProcess(pid, 5_000).catch(() => undefined);
      const log = await tailFile(logFile, 2_000);
      const cause = log
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .at(-1);
      // The last log line is the real cause; put it in the message the UI shows.
      throw new AppError(
        'AGENT_ERROR',
        `QEMU did not start${cause ? `: ${cause.slice(0, 300)}` : ''} (node log ${logFile})`,
        { details: error instanceof Error ? error.message : String(error) },
      );
    }

    const serial = args.indexOf('-serial');
    let internalConsolePort: number | null = null;
    if (serial !== -1) {
      const spec = args[serial + 1] ?? '';
      const match = /^(?:telnet|tcp):([^:]+):(\d+)/.exec(spec);
      if (match?.[2]) internalConsolePort = Number(match[2]);
    }
    let internalVncPort: number | null = null;
    if (vncDisplay !== undefined) internalVncPort = 5900 + vncDisplay;

    if (internalConsolePort !== null && ctx.spec.console.externalPort !== null) {
      await openSerialConsole({
        nodeId: ctx.spec.nodeId,
        externalPort: ctx.spec.console.externalPort,
        projectIp: ctx.projectIp,
        internalPort: internalConsolePort,
      });
    }
    if (internalVncPort !== null && ctx.spec.console.externalPort !== null) {
      await openConsole({
        nodeId: ctx.spec.nodeId,
        externalPort: ctx.spec.console.externalPort,
        projectIp: ctx.projectIp,
        internalPort: internalVncPort,
      });
    }

    runtimes(ctx.registry).set(ctx.spec.nodeId, {
      pid,
      internalConsolePort,
      internalVncPort,
      qmpSocket,
      suspended: false,
      vncDisplay: vncDisplay ?? null,
    });
    return { pid, internalConsolePort, internalVncPort };
  },

  async stop(ctx: NodeContext): Promise<void> {
    const state = runtimes(ctx.registry).get(ctx.spec.nodeId);
    if (state) {
      try {
        const qmp = await QmpClient.connect(state.qmpSocket, 2_000);
        await qmp.execute('quit').catch(() => undefined);
        qmp.close();
      } catch {
        // fall back to signals
      }
      await stopProcess(state.pid, 5_000);
      await rm(state.qmpSocket, { force: true });
      if (state.vncDisplay !== null) {
        ctx.registry.releaseVncDisplay(ctx.spec.projectId, state.vncDisplay);
      }
      runtimes(ctx.registry).delete(ctx.spec.nodeId);
    }
    const client = ubridgeClientFor(ctx.registry, ctx.spec.projectId);
    if (client) {
      for (const port of ctx.spec.ports) {
        if (port.laneType !== 'ethernet') continue;
        const tap = `t${anchorHash(ctx.spec.nodeId, port.adapter, port.port)}`;
        await client.send(`tap delete ${tap}`).catch(() => undefined);
      }
    }
    await closeConsole(ctx.spec.nodeId);
  },

  async suspend(ctx: NodeContext): Promise<void> {
    const state = runtimes(ctx.registry).get(ctx.spec.nodeId);
    if (!state) throw new AppError('NODE_NOT_RUNNING', 'node is not running');
    const qmp = await QmpClient.connect(state.qmpSocket, 3_000);
    await qmp.execute('stop');
    qmp.close();
    state.suspended = true;
  },

  async delete(ctx: NodeContext): Promise<void> {
    await closeConsole(ctx.spec.nodeId);
  },
};

export function registerQemuAdapter(): void {
  registerAdapter(qemuAdapter);
}

/* ---------------------------------------------------------- disk images --- */

export interface DiskOperationOptions {
  config: AgentConfig;
  registry: ProjectRegistry;
  projectId: string;
  nodeId: string;
  disk: string;
  sizeBytes?: number;
  backingImagePath?: string | null;
}

export async function createDiskImage(
  options: DiskOperationOptions,
): Promise<{ path: string; sizeBytes: number }> {
  const target = path.join(
    diskPath(options.config, options.projectId, options.nodeId),
    `${options.disk}.qcow2`,
  );
  await mkdir(path.dirname(target), { recursive: true });
  const args = ['qemu-img', 'create', '-f', 'qcow2'];
  if (options.backingImagePath) args.push('-b', options.backingImagePath, '-F', 'qcow2');
  args.push(target, String(options.sizeBytes ?? 512 * 1024 * 1024));
  const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
  const stderr = await new Response(proc.stderr).text();
  if ((await proc.exited) !== 0) {
    throw new AppError('AGENT_ERROR', `qemu-img create failed`, { details: stderr.trim() });
  }
  const info = await stat(target);
  return { path: target, sizeBytes: info.size };
}

export async function deleteDiskImage(options: DiskOperationOptions): Promise<void> {
  await rm(
    path.join(diskPath(options.config, options.projectId, options.nodeId), `${options.disk}.qcow2`),
    {
      force: true,
    },
  );
}

export async function resizeDiskImage(
  options: DiskOperationOptions & { sizeBytes: number },
): Promise<{ path: string; sizeBytes: number }> {
  const target = path.join(
    diskPath(options.config, options.projectId, options.nodeId),
    `${options.disk}.qcow2`,
  );
  const proc = Bun.spawn(['qemu-img', 'resize', target, String(options.sizeBytes)], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stderr = await new Response(proc.stderr).text();
  if ((await proc.exited) !== 0) {
    throw new AppError('AGENT_ERROR', 'qemu-img resize failed', { details: stderr.trim() });
  }
  const info = await stat(target);
  return { path: target, sizeBytes: info.size };
}

/** Short QMP socket path (< 108 bytes) inside the run directory. */
async function tailFile(file: string, bytes: number): Promise<string> {
  try {
    const text = await readFile(file, 'utf8');
    return text.length > bytes ? text.slice(-bytes).trim() : text.trim();
  } catch {
    return '';
  }
}

export function qmpPath(config: AgentConfig, nodeId: string): string {
  return path.join(config.runDir, 'emulators', `${nodeId.replaceAll('-', '').slice(0, 12)}.qmp`);
}

function diskPath(config: AgentConfig, projectId: string, nodeId: string): string {
  return path.join(config.stateDir, 'projects', projectId, 'nodes', nodeId);
}

export async function qemuNodeSpec(config: AgentConfig, projectId: string, nodeId: string) {
  return readNodeSpec(config, projectId, nodeId);
}
