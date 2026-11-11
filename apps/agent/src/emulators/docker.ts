/** Docker nodes: container lifecycle, veth plumbing, and consoles. */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { anchorHash } from '@netlabor/catalog/anchors';
import { AppError } from '@netlabor/contract';
import { closeConsole, openConsole, openRawBridge } from '../console/proxy.ts';
import {
  type NodeAdapter,
  type NodeContext,
  type NodeStartResult,
  registerAdapter,
} from '../dataplane/node.ts';
import { ubridgeClientFor } from '../dataplane/project.ts';
import type { ProjectRegistry } from '../state.ts';
import { projectShortId } from '../state.ts';
import { chownForEmulator, run, runInNetns } from '../sys.ts';
import { DockerClient } from './docker-client.ts';

interface ManagementNetwork {
  hostEnd: string;
  peer: string;
  containerIp: string;
  subnet: string;
  routeVia: string;
}

interface DockerRuntime {
  containerId: string;
  hostEnds: string[];
  consoleSocket: { write(data: Uint8Array): void; end(): void } | null;
  management: ManagementNetwork | null;
}

function managementSubnet(
  underlayIndex: number,
  index: number,
): { subnet: string; hostIp: string; containerIp: string } {
  const third = 172;
  void third;
  return {
    subnet: `172.31.${underlayIndex}.${index * 4}/30`,
    hostIp: `172.31.${underlayIndex}.${index * 4 + 1}`,
    containerIp: `172.31.${underlayIndex}.${index * 4 + 2}`,
  };
}

/**
 * Give a container a management address reachable from the agent: a veth pair
 * from the project namespace into the container, forwarding inside the
 * namespace, and a host route via the project IP.
 */
async function setupManagementNetwork(
  ctx: NodeContext,
  ubridge: { send(command: string): Promise<string[]> },
  pid: number,
  hash: string,
): Promise<ManagementNetwork> {
  const index = ctx.registry.allocateInternalPort(ctx.spec.projectId, 1);
  const { subnet, hostIp, containerIp } = managementSubnet(ctx.config.underlayIndex, index);
  const hostEnd = `m${hash}h`;
  const peer = `m${hash}p`;
  const nsenter = Bun.which('nsenter');
  if (!nsenter) throw new AppError('BINARY_MISSING', 'nsenter is required for Docker nodes');

  await ubridge.send(`docker create_veth ${hostEnd} ${peer}`);
  await runInNetns(ctx.netns, ['ip', 'addr', 'add', `${hostIp}/30`, 'dev', hostEnd]);
  await runInNetns(ctx.netns, ['ip', 'link', 'set', hostEnd, 'up']);
  const move = await runInNetns(ctx.netns, ['ip', 'link', 'set', peer, 'netns', String(pid)], {
    allowFailure: true,
  });
  if (move.code !== 0) {
    throw new AppError('AGENT_ERROR', `failed to move management interface into container ${pid}`, {
      details: `${move.stdout.trim()} ${move.stderr.trim()}`.trim(),
    });
  }
  const runInContainer = async (argv: string[]): Promise<void> => {
    const proc = Bun.spawn([nsenter, '-t', String(pid), '-n', ...argv], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    if ((await proc.exited) !== 0) {
      throw new AppError('AGENT_ERROR', `container command failed: ${argv.join(' ')}`, {
        details: `${stdout.trim()} ${stderr.trim()}`.trim(),
      });
    }
  };
  await runInContainer(['ip', 'link', 'set', peer, 'name', 'mgmt0']);
  await runInContainer(['ip', 'addr', 'add', `${containerIp}/30`, 'dev', 'mgmt0']);
  await runInContainer(['ip', 'link', 'set', 'mgmt0', 'up']);
  await runInContainer(['ip', 'route', 'add', 'default', 'via', hostIp, 'dev', 'mgmt0']);

  await runInNetns(ctx.netns, ['sysctl', '-w', 'net.ipv4.ip_forward=1'], { allowFailure: true });
  const short = projectShortId(ctx.spec.projectId);
  const routeVia = `nbp${short}`;
  await run(['ip', 'route', 'add', subnet, 'via', ctx.projectIp, 'dev', routeVia], {
    allowFailure: true,
  });
  return { hostEnd, peer, containerIp, subnet, routeVia };
}

const runtime = new WeakMap<ProjectRegistry, Map<string, DockerRuntime>>();

function runtimes(registry: ProjectRegistry): Map<string, DockerRuntime> {
  let map = runtime.get(registry);
  if (!map) {
    map = new Map();
    runtime.set(registry, map);
  }
  return map;
}

function clientFor(ctx: NodeContext): DockerClient {
  return new DockerClient(ctx.config.dockerSocket);
}

function containerName(ctx: NodeContext): string {
  return `netlabor-${ctx.spec.projectId.slice(0, 8)}-${ctx.spec.nodeId.slice(0, 8)}`;
}

async function ensureImage(ctx: NodeContext): Promise<void> {
  const properties = ctx.spec.properties;
  const image = typeof properties.imageName === 'string' ? properties.imageName : 'alpine:3.20';
  const client = clientFor(ctx);
  const images = await client.listImages();
  const present = images.some((entry) =>
    (entry.RepoTags ?? []).some((tag: string) => tag === image || tag === `${image}:latest`),
  );
  if (present) return;
  if (!ctx.config.dockerAutoPull) {
    throw new AppError('IMAGE_MISSING', `Docker image ${image} is not present on this compute`);
  }
  await client.pullImage(image);
}

async function movePeerIntoContainer(
  ctx: NodeContext,
  peer: string,
  pid: number,
  index: number,
  mac: string | null,
): Promise<void> {
  const move = await runInNetns(ctx.netns, ['ip', 'link', 'set', peer, 'netns', String(pid)], {
    allowFailure: true,
  });
  if (move.code !== 0) {
    throw new AppError('AGENT_ERROR', `failed to move ${peer} into container ${pid}`, {
      details: `${move.stdout.trim()} ${move.stderr.trim()}`.trim(),
    });
  }
  const nsenter = Bun.which('nsenter');
  if (!nsenter) throw new AppError('BINARY_MISSING', 'nsenter is required for Docker nodes');
  const rename = Bun.spawn(
    [nsenter, '-t', String(pid), '-n', 'ip', 'link', 'set', peer, 'name', `eth${index}`],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(rename.stdout).text(),
    new Response(rename.stderr).text(),
  ]);
  const renameExit = await rename.exited;
  if (renameExit !== 0) {
    throw new AppError(
      'AGENT_ERROR',
      `failed to rename container interface ${peer} (exit ${renameExit}, pid ${pid})`,
      {
        details: `${stdout.trim()} ${stderr.trim()}`.trim(),
      },
    );
  }
  if (mac) {
    await Bun.spawn([
      nsenter,
      '-t',
      String(pid),
      '-n',
      'ip',
      'link',
      'set',
      `eth${index}`,
      'address',
      mac,
    ]).exited;
  }
  await Bun.spawn([nsenter, '-t', String(pid), '-n', 'ip', 'link', 'set', `eth${index}`, 'up'])
    .exited;
  await Bun.spawn([nsenter, '-t', String(pid), '-n', 'ip', 'link', 'set', 'lo', 'up']).exited;
}

function splitLines(value: unknown): string[] | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * GNS3's Docker extra volumes are node-relative directory paths such as
 * `/etc/frr`. Map those onto the node directory (the node file API root) so a
 * config uploaded through the API is the file the container sees. Entries
 * that already contain a colon are explicit Docker bind specifications.
 */
export function dockerVolumeSpec(entry: string, nodeDir: string): string {
  if (entry.includes(':')) return entry;
  if (!entry.startsWith('/')) {
    throw new AppError('BAD_REQUEST', `Docker extra volume must be an absolute path: ${entry}`);
  }
  const root = path.resolve(nodeDir);
  const host = path.resolve(root, `.${entry}`);
  if (host !== root && !host.startsWith(`${root}${path.sep}`)) {
    throw new AppError('BAD_REQUEST', `Docker extra volume escapes the node directory: ${entry}`);
  }
  return `${host}:${entry}`;
}

async function dockerBinds(
  ctx: NodeContext,
  value: unknown,
): Promise<string[] | null> {
  const entries = splitLines(value);
  if (!entries) return null;
  const binds: string[] = [];
  for (const entry of entries) {
    const spec = dockerVolumeSpec(entry, ctx.dir);
    if (!entry.includes(':')) {
      const host = spec.slice(0, spec.indexOf(':'));
      await mkdir(host, { recursive: true, mode: 0o755 });
      await chownForEmulator(host, ctx.config.emulatorUid, ctx.config.emulatorGid);
    }
    binds.push(spec);
  }
  return binds;
}

const dockerAdapter: NodeAdapter = {
  nodeType: 'docker',

  async create(ctx: NodeContext): Promise<void> {
    await ensureImage(ctx);
  },

  async start(ctx: NodeContext): Promise<NodeStartResult> {
    const properties = ctx.spec.properties;
    const image = typeof properties.imageName === 'string' ? properties.imageName : 'alpine:3.20';
    const client = clientFor(ctx);
    await ensureImage(ctx);

    // A previous failed start can leave a container with the same name behind.
    await client.removeContainerByName(containerName(ctx));
    const containerId = await client.createContainer({
      image,
      name: containerName(ctx),
      labels: {
        'netlabor.project': ctx.spec.projectId,
        'netlabor.node': ctx.spec.nodeId,
      },
      command: typeof properties.startCommand === 'string' ? properties.startCommand : null,
      env: splitLines(properties.environment),
      extraHosts: splitLines(properties.extraHosts),
      binds: await dockerBinds(ctx, properties.extraVolumes),
      privileged: properties.privileged !== false,
    });
    await client.startContainer(containerId);
    const inspected = await client.inspectContainer(containerId);
    const pid = inspected.State.Pid;

    const ubridge = ubridgeClientFor(ctx.registry, ctx.spec.projectId);
    if (!ubridge) throw new AppError('AGENT_ERROR', 'project ubridge is not running');
    const hostEnds: string[] = [];
    const macBase = typeof properties.macAddress === 'string' ? properties.macAddress : null;
    let index = 0;
    for (const port of ctx.spec.ports) {
      if (port.laneType !== 'ethernet') continue;
      const hash = anchorHash(ctx.spec.nodeId, port.adapter, port.port);
      const hostEnd = `v${hash}h`;
      const peerEnd = `v${hash}p`;
      await ubridge.send(`docker create_veth ${hostEnd} ${peerEnd}`);
      await runInNetns(ctx.netns, ['ip', 'link', 'set', hostEnd, 'up'], { allowFailure: true });
      const mac = macBase
        ? `${macBase.slice(0, 10)}${(
            (Number.parseInt(macBase.slice(10, 12) || '0', 16) + index) %
            256
          )
            .toString(16)
            .padStart(2, '0')}`
        : null;
      await movePeerIntoContainer(ctx, peerEnd, pid, index, mac);
      hostEnds.push(hostEnd);
      index++;
    }

    // Console: exec a shell attached to a TTY and bridge it to the listener.
    const consoleType =
      typeof properties.consoleType === 'string' ? properties.consoleType : 'telnet';
    let consoleSocket: DockerRuntime['consoleSocket'] = null;
    if (consoleType === 'telnet' && ctx.spec.console.externalPort !== null) {
      const user = typeof properties.consoleUser === 'string' ? properties.consoleUser : null;
      let session: { write(data: Uint8Array): void; close(): void } | null = null;
      await openRawBridge({
        nodeId: ctx.spec.nodeId,
        externalPort: ctx.spec.console.externalPort,
        connect: (onData, onClose) => {
          void client
            .execDuplex(containerId, ['/bin/sh'], { onData, onClose }, { user })
            .then((duplex) => {
              session = duplex;
            })
            .catch(() => onClose());
          return {
            write(data: Uint8Array) {
              session?.write(data);
            },
            close() {
              session?.close();
            },
          };
        },
      });
      consoleSocket = {
        write(data: Uint8Array) {
          session?.write(data);
        },
        end() {
          session?.close();
        },
      };
    }

    let management: ManagementNetwork | null = null;
    if (consoleType === 'http' || consoleType === 'https') {
      if (ctx.spec.console.externalPort === null) {
        throw new AppError('BAD_REQUEST', 'HTTP console requires an external port');
      }
      const hash = anchorHash(ctx.spec.nodeId, 0, 0);
      management = await setupManagementNetwork(ctx, ubridge, pid, hash);
      const targetPort = Number(properties.consoleHttpPort ?? (consoleType === 'https' ? 443 : 80));
      await openConsole({
        nodeId: ctx.spec.nodeId,
        externalPort: ctx.spec.console.externalPort,
        projectIp: management.containerIp,
        internalPort: targetPort,
      });
    }
    runtimes(ctx.registry).set(ctx.spec.nodeId, {
      containerId,
      hostEnds,
      consoleSocket,
      management,
    });
    return {
      pid,
      internalConsolePort: null,
      internalVncPort: null,
      extra: { containerId },
    };
  },

  async stop(ctx: NodeContext): Promise<void> {
    const state = runtimes(ctx.registry).get(ctx.spec.nodeId);
    await closeConsole(ctx.spec.nodeId);
    if (!state) return;
    state.consoleSocket?.end();
    const client = clientFor(ctx);
    await client.stopContainer(state.containerId);
    await client.removeContainer(state.containerId);
    const ubridge = ubridgeClientFor(ctx.registry, ctx.spec.projectId);
    if (state.management) {
      await run(
        [
          'ip',
          'route',
          'del',
          state.management.subnet,
          'via',
          ctx.projectIp,
          'dev',
          state.management.routeVia,
        ],
        {
          allowFailure: true,
        },
      );
      if (ubridge) {
        await ubridge.send(`link delete ${state.management.hostEnd}`).catch(() => undefined);
      }
      await runInNetns(ctx.netns, ['ip', 'link', 'delete', state.management.hostEnd], {
        allowFailure: true,
      });
    }
    for (const hostEnd of state.hostEnds) {
      if (ubridge) await ubridge.send(`link delete ${hostEnd}`).catch(() => undefined);
      await runInNetns(ctx.netns, ['ip', 'link', 'delete', hostEnd], { allowFailure: true });
    }
    runtimes(ctx.registry).delete(ctx.spec.nodeId);
  },

  async delete(ctx: NodeContext): Promise<void> {
    await closeConsole(ctx.spec.nodeId);
  },
};

export function registerDockerAdapter(): void {
  registerAdapter(dockerAdapter);
}

export function dockerClientFor(config: NodeContext['config']): DockerClient {
  return new DockerClient(config.dockerSocket);
}
