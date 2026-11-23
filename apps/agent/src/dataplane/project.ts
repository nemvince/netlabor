/** Project namespace lifecycle: netns, uplink veth, routes, ubridge. */

import { mkdir, readdir, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type AgentProjectMeta, AppError } from '@netlabor/contract';
import { netnsName } from '@netlabor/shared';
import type { AgentConfig } from '../config.ts';
import { startMarkerSink } from '../markers/sink.ts';
import {
  addAddress,
  addDefaultRoute,
  addNetns,
  addRoute,
  createVethPair,
  deleteLink,
  deleteNetns,
  enableIpForwarding,
  installNftRules,
  listNetns,
  moveLinkToNetns,
  netnsExists,
  renameLink,
  setLinkUp,
} from '../netns/netns.ts';
import type { ProjectRegistry } from '../state.ts';
import { hostVethIp, peerVethIp, projectIpFor, projectShortId } from '../state.ts';
import type { UbridgeClient } from '../ubridge/client.ts';
import { startUbridge, type UbridgeProcess } from '../ubridge/process.ts';

export const PROJECT_DIRS = ['nodes', 'links', 'captures', 'logs'] as const;

interface ProjectMetaFile {
  projectId: string;
  slot: number;
  netns: string;
  projectIp: string;
  ubridgeSocket: string | null;
  markerPort: number | null;
  createdAt: string;
}

export function projectDir(config: AgentConfig, projectId: string): string {
  return path.join(config.projectDir, projectId);
}

export function nodeDir(config: AgentConfig, projectId: string, nodeId: string): string {
  return path.join(projectDir(config, projectId), 'nodes', nodeId);
}

export function captureDir(config: AgentConfig, projectId: string): string {
  return path.join(projectDir(config, projectId), 'captures');
}

async function readMeta(projectPath: string): Promise<ProjectMetaFile | null> {
  try {
    return JSON.parse(
      await readFile(path.join(projectPath, 'meta.json'), 'utf8'),
    ) as ProjectMetaFile;
  } catch {
    return null;
  }
}

async function writeMeta(projectPath: string, meta: ProjectMetaFile): Promise<void> {
  await writeFile(path.join(projectPath, 'meta.json'), JSON.stringify(meta, null, 2), {
    mode: 0o644,
  });
}

export interface ProjectDeps {
  config: AgentConfig;
  registry: ProjectRegistry;
  logger?: import('@netlabor/shared').Logger;
  onMarkerHit?: (hit: import('../markers/sink.ts').MarkerHit) => void;
}

interface ProjectHandles {
  ubridge?: UbridgeProcess;
  markerSink?: { stop(): void };
}

const handles = new WeakMap<ProjectRegistry, Map<string, ProjectHandles>>();

function handleMap(registry: ProjectRegistry): Map<string, ProjectHandles> {
  let map = handles.get(registry);
  if (!map) {
    map = new Map();
    handles.set(registry, map);
  }
  return map;
}

/**
 * Create (or adopt) the namespace, uplink veth, host routes, and ubridge for a
 * project. Idempotent: an existing namespace with matching meta.json is reused.
 */
export async function ensureProject(
  deps: ProjectDeps,
  projectId: string,
  slot: number,
  markerPortFromController: number | null = null,
): Promise<AgentProjectMeta> {
  const { config, registry } = deps;
  const existing = registry.get(projectId);
  if (existing) return registry.projectMeta(existing);
  if (slot < 1 || slot > 254) throw new AppError('BAD_REQUEST', 'project slot must be 1..254');

  const short = projectShortId(projectId);
  const netns = netnsName(projectId);
  const projectIp = projectIpFor(config, slot);
  const projectPath = projectDir(config, projectId);
  await mkdir(projectPath, { recursive: true, mode: 0o755 });
  for (const dir of PROJECT_DIRS)
    await mkdir(path.join(projectPath, dir), { recursive: true, mode: 0o755 });

  const previous = await readMeta(projectPath);
  const exists = await netnsExists(netns);
  if (previous && previous.projectId !== projectId) {
    throw new AppError('CONFLICT', `namespace ${netns} belongs to another project`);
  }
  if (previous && exists && previous.slot !== slot) {
    // A reused namespace keeps its slot; the controller must reset the project.
    throw new AppError('CONFLICT', `project ${projectId} already uses slot ${previous.slot}`);
  }

  const hostEnd = `nbp${short}`;
  const peerEnd = `nbp${short}p`;
  const ubridgeSocket = path.join(config.runDir, `${short}.sock`);

  if (!exists) {
    await addNetns(netns);
    await setLinkUp(netns, 'lo');
    await createVethPair(hostEnd, peerEnd);
    await addAddress(null, hostEnd, `${hostVethIp(slot)}/30`);
    await setLinkUp(null, hostEnd);
    await moveLinkToNetns(peerEnd, netns);
    await renameLink(netns, peerEnd, 'uplink0');
    await addAddress(netns, 'uplink0', `${peerVethIp(slot)}/30`);
    await addAddress(netns, 'uplink0', `${projectIp}/32`);
    await setLinkUp(netns, 'uplink0');
    await addDefaultRoute(netns, hostVethIp(slot), 'uplink0');
    await addRoute(null, `${projectIp}/32`, hostEnd);
  } else {
    // Reuse the namespace but make sure the host route exists.
    await setLinkUp(null, hostEnd).catch(() => undefined);
    await addRoute(null, `${projectIp}/32`, hostEnd);
  }

  await enableIpForwarding();
  await installNftRules(config.underlayInterface);

  const markerPort = markerPortFromController;
  const ubridge = await startUbridge({
    config,
    netns,
    short,
    markerSink: markerPort ? `${hostVethIp(slot)}:${markerPort}` : null,
    markerProject: projectId,
  });
  const projectHandles: ProjectHandles = { ubridge };
  if (markerPort !== null && deps.logger && deps.onMarkerHit) {
    projectHandles.markerSink = await startMarkerSink({
      host: hostVethIp(slot),
      port: markerPort,
      projectId,
      logger: deps.logger,
      onHit: deps.onMarkerHit,
    }).catch((error: unknown) => {
      deps.logger?.warn('marker sink failed to bind', {
        projectId,
        port: markerPort,
        err: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    });
  }
  handleMap(registry).set(projectId, projectHandles);

  const runtime = registry.register({
    projectId,
    slot,
    netns,
    projectIp,
    ubridgeSocket,
    ubridgePid: ubridge.pid,
  });
  await writeMeta(projectPath, {
    projectId,
    slot,
    netns,
    projectIp,
    ubridgeSocket,
    markerPort,
    createdAt: previous?.createdAt ?? new Date().toISOString(),
  });
  void runtime;
  return registry.projectMeta(runtime);
}

/** Remove the namespace and every dataplane object for a project. */
export async function removeProject(
  deps: ProjectDeps,
  projectId: string,
  options: { deleteFiles?: boolean } = {},
): Promise<void> {
  const { config, registry } = deps;
  const runtime = registry.get(projectId);
  const short = projectShortId(projectId);
  const netns = runtime?.netns ?? netnsName(projectId);

  const handle = handleMap(registry).get(projectId);
  handle?.markerSink?.stop();
  if (handle?.ubridge) await handle.ubridge.stop();
  handleMap(registry).delete(projectId);

  await deleteLink(`nbp${short}`).catch(() => undefined);
  await deleteNetns(netns);
  registry.remove(projectId);

  if (options.deleteFiles) {
    await rm(projectDir(config, projectId), { recursive: true, force: true });
  }
}

/** ubridge client for an open project, if the agent started one. */
export function ubridgeClientFor(
  registry: ProjectRegistry,
  projectId: string,
): UbridgeClient | null {
  const handle = handleMap(registry).get(projectId);
  return handle?.ubridge?.client ?? null;
}

/** Read the persisted project meta without a live registry entry. */
export async function readProjectMeta(
  config: AgentConfig,
  projectId: string,
): Promise<AgentProjectMeta | null> {
  const meta = await readMeta(projectDir(config, projectId));
  if (!meta) return null;
  return {
    projectId: meta.projectId,
    slot: meta.slot,
    netns: meta.netns,
    projectIp: meta.projectIp,
    ubridgeSocket: meta.ubridgeSocket,
  };
}

/** Agent startup: remove namespaces, sockets, and links left by a dead agent. */
async function killOrphanProcesses(config: AgentConfig): Promise<number> {
  let killed = 0;
  const projectsRoot = config.projectDir;
  const runRoot = `${config.runDir}/`;
  for (const entry of await readdir('/proc')) {
    const pid = Number(entry);
    if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) continue;
    try {
      const cmdline = (await readFile(`/proc/${pid}/cmdline`)).toString().replaceAll('\0', ' ');
      let orphan = cmdline.includes(runRoot);
      if (!orphan) {
        const cwd = await readlink(`/proc/${pid}/cwd`).catch(() => '');
        orphan = cwd.startsWith(projectsRoot);
      }
      if (!orphan) continue;
      process.kill(pid, 'SIGKILL');
      killed++;
    } catch {
      // process vanished or is not ours
    }
  }
  return killed;
}

export async function cleanupStaleState(
  config: AgentConfig,
): Promise<{ namespaces: string[]; sockets: number; processes: number }> {
  // Kill emulators/ubridge left behind by an agent crash before touching
  // namespaces; otherwise they hold TAPs and sockets and later starts fail.
  const processes = await killOrphanProcesses(config);
  const namespaces: string[] = [];
  for (const name of await listNetns()) {
    if (!name.startsWith('nb-')) continue;
    await deleteNetns(name);
    namespaces.push(name);
  }
  let sockets = 0;
  try {
    const entries = new Bun.Glob('*.sock').scan(config.runDir);
    for await (const entry of entries) {
      await rm(path.join(config.runDir, entry), { force: true });
      sockets++;
    }
  } catch {
    // run dir missing: nothing to clean
  }
  for (const name of await listProjectLinks()) {
    await deleteLink(name);
  }
  return { namespaces, sockets, processes };
}

async function listProjectLinks(): Promise<string[]> {
  const result = await Bun.$`ip -o link show`.quiet().nothrow();
  const text = new TextDecoder().decode(result.stdout);
  return text
    .split('\n')
    .map((line) => /^\d+:\s+([^:@]+)[:@]/.exec(line)?.[1]?.trim() ?? '')
    .filter(
      (name) =>
        name.startsWith('nbp') ||
        name.startsWith('lk') ||
        name.startsWith('sw') ||
        name.startsWith('hb'),
    );
}
