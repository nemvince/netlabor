/**
 * Link dataplane: kernel bridges for same-compute interface pairs, ubridge
 * relays for TAP/veth/UDP endpoints and cross-compute links.
 */

import { type AgentLinkSpec, type AgentLinkState, AppError } from '@netlabor/contract';
import { createLogger } from '@netlabor/shared';
import type { AgentConfig } from '../config.ts';
import { addDynamipsNio } from '../emulators/dynamips.ts';
import { setVpcsUdp } from '../emulators/vpcs.ts';
import type { LinkRuntime, ProjectRegistry } from '../state.ts';
import { runInNetns } from '../sys.ts';
import { type UbridgeClient, UbridgeError } from '../ubridge/client.ts';
import { capturePathFor, markerPcapPath } from './capture.ts';
import { ubridgeClientFor } from './project.ts';

export interface LinkDeps {
  config: AgentConfig;
  registry: ProjectRegistry;
  markers?: import('../markers/watcher.ts').MarkerWatcher;
}

const logger = createLogger({ service: 'agent-dataplane' });

/**
 * Dataplane object names for a link. UUIDv7 IDs created in the same
 * millisecond share their prefix, so slicing the ID would collide two links
 * onto one bridge; hash the ID instead.
 */
function linkObjects(linkId: string): { bridge: string; kernelBridge: string; relayTap: string } {
  const hash = new Bun.CryptoHasher('sha256').update(linkId).digest('hex').slice(0, 10);
  return { bridge: `lk${hash}`, kernelBridge: `lk${hash}k`, relayTap: `tr${hash}` };
}

function ubridgeFailureText(error: unknown): string {
  if (error instanceof UbridgeError) {
    return `${error.code} ${error.payload.join(' ')}`.trim();
  }
  return error instanceof Error ? error.message : String(error);
}

function isAllowedFailure(error: unknown, patterns: RegExp[]): boolean {
  const text = ubridgeFailureText(error);
  return patterns.some((pattern) => pattern.test(text));
}

/** Send a ubridge command, surfacing unexpected failures with the payload. */
async function sendUbridge(
  client: UbridgeClient,
  command: string,
  options: { allow?: RegExp[]; context?: string } = {},
): Promise<string[]> {
  try {
    return await client.send(command);
  } catch (error) {
    if (isAllowedFailure(error, options.allow ?? [])) {
      logger.debug('ubridge command ignored', {
        command,
        reason: ubridgeFailureText(error),
        context: options.context ?? null,
      });
      return [];
    }
    logger.error('ubridge command failed', {
      command,
      context: options.context ?? null,
      code: error instanceof UbridgeError ? error.code : null,
      payload: error instanceof UbridgeError ? error.payload : null,
      err: error,
    });
    throw new AppError('AGENT_ERROR', `ubridge command failed: ${command}`, {
      details: ubridgeFailureText(error),
    });
  }
}

/** Best-effort deletion: expected "already gone" outcomes are ignored. */
async function deleteUbridge(
  client: UbridgeClient,
  command: string,
  context: string,
): Promise<void> {
  try {
    await client.send(command);
  } catch (error) {
    const text = ubridgeFailureText(error);
    // A missing object, an inactive capture, or a kernel bridge whose ports
    // are detached by the following `ip link delete` are all expected here.
    if (
      /doesn't exist|does not exist|No such device|No such file|not found|not running|no TAP|no packet capture|EBUSY, ports still attached/i.test(
        text,
      )
    ) {
      logger.debug('ubridge object already absent', { command, context });
      return;
    }
    logger.warn('ubridge cleanup failed', {
      command,
      context,
      code: error instanceof UbridgeError ? error.code : null,
      payload: error instanceof UbridgeError ? error.payload : null,
    });
  }
}

async function ubridge(deps: LinkDeps, projectId: string) {
  const client = ubridgeClientFor(deps.registry, projectId);
  if (!client) throw new AppError('AGENT_ERROR', 'project ubridge is not running');
  return client;
}

async function netnsOf(deps: LinkDeps, projectId: string): Promise<string> {
  const project = deps.registry.get(projectId);
  if (!project) throw new AppError('NODE_NOT_RUNNING', 'project namespace is not open');
  return project.netns;
}

function laneDlt(laneType: string): string {
  switch (laneType) {
    case 'serial':
      return 'DLT_C_HDLC';
    case 'atm':
      return 'DLT_ATM_RFC1483';
    case 'frame_relay':
      return 'DLT_FRELAY';
    default:
      return 'DLT_EN10MB';
  }
}

export function dltForLane(laneType: string): string {
  return laneDlt(laneType);
}

/** Create or recreate the dataplane objects for a link. */
export async function createLink(deps: LinkDeps, spec: AgentLinkSpec): Promise<AgentLinkState> {
  const netns = await netnsOf(deps, spec.projectId);
  const project = deps.registry.get(spec.projectId);
  if (!project) throw new AppError('NODE_NOT_RUNNING', 'project namespace is not open');
  await deleteLinkDataplane(deps, spec.projectId, spec.linkId);

  const names = linkObjects(spec.linkId);
  const bridge = names.bridge;
  const anchors: string[] = [];
  const udpPorts: number[] = [];

  if (spec.mode === 'kernel') {
    const first = spec.endpoints[0];
    const second = spec.endpoints[1];
    if (!first || !second || first.anchor.kind === 'udp' || second.anchor.kind === 'udp') {
      throw new AppError('BAD_REQUEST', 'kernel mode requires two kernel interfaces');
    }
    const client = await ubridge(deps, spec.projectId);
    await sendUbridge(client, `brctl create ${bridge}`, {
      allow: [/File exists/i, /already exist/i],
      context: `link ${spec.linkId} kernel bridge`,
    });
    await runInNetns(netns, ['ip', 'link', 'set', bridge, 'up']);
    for (const endpoint of spec.endpoints) {
      const name = endpoint.anchor.name;
      if (!name) throw new AppError('BAD_REQUEST', 'endpoint has no interface name');
      await runInNetns(netns, ['ip', 'link', 'set', name, 'master', bridge]);
      await runInNetns(netns, ['ip', 'link', 'set', name, 'up']);
      anchors.push(name);
    }
    await applyKernelFilters(deps, spec, anchors);
  } else {
    const client = await ubridge(deps, spec.projectId);
    await sendUbridge(client, `bridge create ${bridge}`, {
      allow: [/already exist/i],
      context: `link ${spec.linkId}`,
    });
    for (const endpoint of spec.endpoints) {
      if (endpoint.emulatorUdp && endpoint.nodeType === 'vpcs') {
        const { localPort, remotePort, remoteHost } = endpoint.emulatorUdp;
        await setVpcsUdp(
          deps.config,
          deps.registry,
          spec.projectId,
          endpoint.nodeId,
          `${localPort}:${remotePort}:${remoteHost}`,
        );
      }
      if (endpoint.emulatorUdp && endpoint.nodeType === 'dynamips' && endpoint.udp) {
        const node = deps.registry.node(endpoint.nodeId);
        if (node) {
          const adapter = endpoint.anchor.name ? Number(endpoint.anchor.name.split('/')[0]) : 0;
          const portIndex = endpoint.anchor.name ? Number(endpoint.anchor.name.split('/')[1]) : 0;
          await addDynamipsNio(
            deps.registry,
            spec.projectId,
            node.extra.vmName ?? node.nodeId,
            adapter,
            portIndex,
            endpoint.udp.lport,
            endpoint.udp.rhost,
            endpoint.udp.rport,
          ).catch(() => undefined);
        }
      }
      if (endpoint.anchor.kind === 'tap' && endpoint.anchor.name) {
        await sendUbridge(client, `bridge add_nio_tap ${bridge} ${endpoint.anchor.name}`, {
          context: `link ${spec.linkId} tap anchor`,
        });
        anchors.push(endpoint.anchor.name);
        continue;
      }
      if (endpoint.anchor.kind === 'veth' && endpoint.anchor.name) {
        // Kernel interface: enslave it to a kernel bridge and relay through a TAP
        // so that ubridge never competes for the interface.
        await sendUbridge(client, `brctl create ${names.kernelBridge}`, {
          allow: [/File exists/i, /already exist/i],
          context: `link ${spec.linkId} relay bridge`,
        });
        await runInNetns(netns, ['ip', 'link', 'set', names.kernelBridge, 'up']);
        await runInNetns(netns, [
          'ip',
          'link',
          'set',
          endpoint.anchor.name,
          'master',
          names.kernelBridge,
        ]);
        await runInNetns(netns, ['ip', 'link', 'set', endpoint.anchor.name, 'up']);
        await sendUbridge(client, `tap create ${names.relayTap}`, {
          allow: [/Device or resource busy/i, /File exists/i, /already exist/i],
          context: `link ${spec.linkId} relay tap`,
        });
        await runInNetns(netns, [
          'ip',
          'link',
          'set',
          names.relayTap,
          'master',
          names.kernelBridge,
        ]);
        await runInNetns(netns, ['ip', 'link', 'set', names.relayTap, 'up']);
        await sendUbridge(client, `bridge add_nio_tap ${bridge} ${names.relayTap}`, {
          context: `link ${spec.linkId} relay tap NIO`,
        });
        anchors.push(endpoint.anchor.name);
        continue;
      }
      if (endpoint.udp) {
        const { lport, rhost, rport } = endpoint.udp;
        await sendUbridge(client, `bridge add_nio_udp ${bridge} ${lport} ${rhost} ${rport}`, {
          context: `link ${spec.linkId} udp anchor for node ${endpoint.nodeId}`,
        });
        udpPorts.push(lport);
      }
    }
    if (spec.peer) {
      if (spec.peer.port <= 0 || spec.peer.localPort <= 0) {
        throw new AppError('BAD_REQUEST', 'peer link needs both UDP ports');
      }
      await sendUbridge(
        client,
        `bridge add_nio_udp ${bridge} ${spec.peer.localPort} ${spec.peer.projectIp} ${spec.peer.port}`,
        { context: `link ${spec.linkId} peer NIO` },
      );
      udpPorts.push(spec.peer.localPort);
    }
    // A ubridge bridge forwards only once started, even with both NIOs added.
    await sendUbridge(client, `bridge start ${bridge}`, {
      allow: [/already running/i],
      context: `link ${spec.linkId} start`,
    });
    await applyRelayFilters(deps, spec);
    await applyRelayMarkers(deps, spec);
  }

  const runtime: LinkRuntime = {
    linkId: spec.linkId,
    projectId: spec.projectId,
    status: 'active',
    mode: spec.mode,
    bridgeName: bridge,
    anchors,
    udpPorts,
    message: null,
  };
  project.links.set(spec.linkId, runtime);
  return { linkId: spec.linkId, status: 'active', message: null };
}

export async function deleteLinkDataplane(
  deps: LinkDeps,
  projectId: string,
  linkId: string,
): Promise<void> {
  const project = deps.registry.get(projectId);
  const netns = project?.netns;
  const names = linkObjects(linkId);
  const client = ubridgeClientFor(deps.registry, projectId);
  if (client) {
    const context = `link ${linkId} cleanup`;
    await deleteUbridge(client, `bridge stop_capture ${names.bridge}`, context);
    await deleteUbridge(client, `bridge delete ${names.bridge}`, context);
    await deleteUbridge(client, `brctl delete ${names.bridge}`, context);
    await deleteUbridge(client, `brctl delete ${names.kernelBridge}`, context);
  }
  if (netns) {
    // Deleting the kernel bridge releases the switch anchor; the relay TAP is
    // then removed explicitly so the next create starts from a clean slate.
    await runInNetns(netns, ['ip', 'link', 'delete', names.kernelBridge], { allowFailure: true });
    await runInNetns(netns, ['ip', 'link', 'delete', names.bridge], { allowFailure: true });
  }
  if (client) await deleteUbridge(client, `tap delete ${names.relayTap}`, `link ${linkId} cleanup`);
  if (netns) {
    await runInNetns(netns, ['ip', 'link', 'delete', names.relayTap], { allowFailure: true });
  }
  project?.links.delete(linkId);
  project?.captures.delete(linkId);
}

export async function deleteLink(deps: LinkDeps, projectId: string, linkId: string): Promise<void> {
  await deleteLinkDataplane(deps, projectId, linkId);
}

export async function resetLink(deps: LinkDeps, spec: AgentLinkSpec): Promise<AgentLinkState> {
  await deleteLinkDataplane(deps, spec.projectId, spec.linkId);
  return createLink(deps, spec);
}

export async function suspendLink(
  deps: LinkDeps,
  projectId: string,
  linkId: string,
): Promise<void> {
  const project = deps.registry.get(projectId);
  const runtime = project?.links.get(linkId);
  if (!project || !runtime) return;
  const client = ubridgeClientFor(deps.registry, projectId);
  if (runtime.mode === 'kernel') {
    for (const anchor of runtime.anchors) {
      await runInNetns(project.netns, ['ip', 'link', 'set', anchor, 'down'], {
        allowFailure: true,
      });
    }
  } else if (client) {
    await client.send(`bridge stop ${runtime.bridgeName}`).catch(() => undefined);
  }
  runtime.status = 'suspended';
}

/* --------------------------------------------------------------- filters --- */

function filterNumber(filters: Record<string, unknown>, key: string): number | null {
  const value = filters[key];
  if (value === undefined || value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** One netem arg list for every filter; tc accepts them in a single qdisc. */
export function netemArgs(filters: Record<string, unknown>): string[] {
  const delay = filterNumber(filters, 'delayMs');
  const jitter = filterNumber(filters, 'jitterMs');
  const loss = filterNumber(filters, 'lossPct');
  const corrupt = filterNumber(filters, 'corruptPct');
  const rate = filterNumber(filters, 'rateKbps');
  const args: string[] = [];
  if (delay !== null && delay > 0) args.push('delay', `${delay}ms`);
  if (jitter !== null && jitter > 0 && delay !== null && delay > 0) {
    args.push('jitter', `${jitter}ms`);
  }
  if (loss !== null && loss > 0) args.push('loss', `${loss}%`);
  if (corrupt !== null && corrupt > 0) args.push('corrupt', `${corrupt}%`);
  if (rate !== null && rate > 0) args.push('rate', `${rate}kbit`);
  return args;
}

async function applyKernelFilters(
  deps: LinkDeps,
  spec: AgentLinkSpec,
  anchors: string[],
): Promise<void> {
  const netns = await netnsOf(deps, spec.projectId);
  // One netem qdisc carrying every parameter; sequential `change` calls would
  // drop previously set parameters and fail when no qdisc exists yet.
  const args = netemArgs(spec.filters ?? {});
  for (const anchor of anchors) {
    await runInNetns(netns, ['tc', 'qdisc', 'del', 'dev', anchor, 'root'], { allowFailure: true });
    if (args.length === 0) continue;
    await runInNetns(netns, ['tc', 'qdisc', 'add', 'dev', anchor, 'root', 'netem', ...args]);
  }
}

async function applyRelayFilters(deps: LinkDeps, spec: AgentLinkSpec): Promise<void> {
  const client = await ubridge(deps, spec.projectId);
  const bridge = linkObjects(spec.linkId).bridge;
  await client.send(`bridge reset_packet_filters ${bridge}`).catch(() => undefined);
  const filters = spec.filters ?? {};
  const delay = filterNumber(filters, 'delayMs');
  const jitter = filterNumber(filters, 'jitterMs') ?? 0;
  if (delay !== null && delay > 0) {
    await client
      .send(`bridge add_packet_filter ${bridge} delay delay ${delay} ${jitter}`)
      .catch(() => undefined);
  }
  const loss = filterNumber(filters, 'lossPct');
  if (loss !== null && loss > 0) {
    await client
      .send(`bridge add_packet_filter ${bridge} loss packet_loss ${loss}`)
      .catch(() => undefined);
  }
  const corrupt = filterNumber(filters, 'corruptPct');
  if (corrupt !== null && corrupt > 0) {
    await client
      .send(`bridge add_packet_filter ${bridge} corrupt corrupt ${corrupt}`)
      .catch(() => undefined);
  }
  const frequency = filterNumber(filters, 'frequencyDrop');
  if (frequency !== null && frequency !== 0) {
    await client
      .send(`bridge add_packet_filter ${bridge} freq frequency_drop ${frequency}`)
      .catch(() => undefined);
  }
  if (typeof filters.bpf === 'string' && filters.bpf.length > 0) {
    await client
      .send(`bridge add_packet_filter ${bridge} bpf bpf ${filters.bpf}`)
      .catch(() => undefined);
  }
}

export async function applyFilters(deps: LinkDeps, spec: AgentLinkSpec): Promise<void> {
  const project = deps.registry.get(spec.projectId);
  const runtime = project?.links.get(spec.linkId);
  if (!runtime) throw new AppError('NOT_FOUND', 'link is not active on this compute');
  if (spec.mode === 'kernel') {
    await applyKernelFilters(deps, spec, runtime.anchors);
    return;
  }
  await applyRelayFilters(deps, spec);
}

/* --------------------------------------------------------------- markers --- */

function markerSuffix(laneType: string): string {
  switch (laneType) {
    case 'serial':
      return ' linktype C_HDLC';
    case 'atm':
      return ' linktype ATM_RFC1483';
    case 'frame_relay':
      return ' linktype FRELAY';
    default:
      return '';
  }
}

async function applyRelayMarkers(deps: LinkDeps, spec: AgentLinkSpec): Promise<void> {
  deps.markers?.register(
    spec.projectId,
    spec.linkId,
    (spec.markers ?? []).map((marker) => ({
      name: marker.name,
      tag: marker.tag,
      direction: marker.direction ?? null,
      pcapPath:
        marker.pcapPath && marker.pcapPath.length > 0
          ? marker.pcapPath
          : markerPcapPath(deps.config, spec.projectId, spec.linkId, marker.name),
    })),
  );
  const client = await ubridge(deps, spec.projectId);
  const bridge = linkObjects(spec.linkId).bridge;
  const suffix = markerSuffix(spec.laneType);
  for (const marker of spec.markers ?? []) {
    const direction = marker.direction ? ` dir ${marker.direction}` : '';
    const pcapPath =
      marker.pcapPath && marker.pcapPath.length > 0
        ? marker.pcapPath
        : markerPcapPath(deps.config, spec.projectId, spec.linkId, marker.name);
    await client
      .send(
        `bridge add_packet_filter ${bridge} ${marker.name} mark "${marker.bpf}" tag ${marker.tag} link ${spec.linkId}${direction} pcap "${pcapPath}"${suffix}`,
      )
      .catch((error: unknown) => {
        throw new AppError('AGENT_ERROR', `failed to program marker ${marker.name}`, {
          details: error instanceof Error ? error.message : String(error),
        });
      });
  }
}

export async function applyMarkers(deps: LinkDeps, spec: AgentLinkSpec): Promise<void> {
  const runtime = deps.registry.get(spec.projectId)?.links.get(spec.linkId);
  if (!runtime) throw new AppError('NOT_FOUND', 'link is not active on this compute');
  deps.markers?.register(
    spec.projectId,
    spec.linkId,
    (spec.markers ?? []).map((marker) => ({
      name: marker.name,
      tag: marker.tag,
      direction: marker.direction ?? null,
      pcapPath:
        marker.pcapPath && marker.pcapPath.length > 0
          ? marker.pcapPath
          : markerPcapPath(deps.config, spec.projectId, spec.linkId, marker.name),
    })),
  );
  if (spec.mode === 'relay') {
    await applyRelayMarkers(deps, spec);
    return;
  }
  const client = ubridgeClientFor(deps.registry, spec.projectId);
  if (!client) return;
  const anchor = runtime.anchors[0];
  if (!anchor) throw new AppError('AGENT_ERROR', 'kernel link has no anchor');
  const suffix = markerSuffix(spec.laneType);
  for (const marker of spec.markers ?? []) {
    const direction = marker.direction ? ` dir ${marker.direction}` : '';
    const pcapPath =
      marker.pcapPath && marker.pcapPath.length > 0
        ? marker.pcapPath
        : markerPcapPath(deps.config, spec.projectId, spec.linkId, marker.name);
    await client.send(
      `marker add_kernel ${marker.name} ${anchor} "${marker.bpf}" tag ${marker.tag} link ${spec.linkId}${direction} pcap "${pcapPath}"${suffix}`,
    );
  }
}

export async function clearMarkers(
  deps: LinkDeps,
  projectId: string,
  linkId: string,
): Promise<void> {
  const client = ubridgeClientFor(deps.registry, projectId);
  if (!client) return;
  await client.send(`marker pause ${linkId}`).catch(() => undefined);
  await client.send(`marker del_link ${linkId}`).catch(() => undefined);
}

/* ---------------------------------------------------------------- capture --- */

export async function startCapture(
  deps: LinkDeps,
  spec: {
    linkId: string;
    projectId: string;
    mode: 'kernel' | 'relay';
    dlt: string;
  },
): Promise<{ path: string; dlt: string; active: boolean }> {
  const project = deps.registry.get(spec.projectId);
  const runtime = project?.links.get(spec.linkId);
  if (!project || !runtime) throw new AppError('NODE_NOT_RUNNING', 'link dataplane is not active');
  const client = ubridgeClientFor(deps.registry, spec.projectId);
  if (!client) throw new AppError('AGENT_ERROR', 'project ubridge is not running');

  const path = capturePathFor(deps.config, spec.projectId, spec.linkId);
  if (spec.mode === 'relay') {
    // Idempotent: an orphaned capture from a previous viewer must not block us.
    await client.send(`bridge stop_capture ${runtime.bridgeName}`).catch(() => undefined);
    await client.send(`bridge start_capture ${runtime.bridgeName} "${path}"`);
  } else {
    const anchor = runtime.anchors[0];
    if (!anchor) throw new AppError('AGENT_ERROR', 'kernel link has no anchor');
    await client.send(`capture stop_kernel ${anchor}`).catch(() => undefined);
    await client.send(`capture start_kernel ${anchor} "${path}" ${spec.dlt}`);
  }
  project.captures.set(spec.linkId, {
    linkId: spec.linkId,
    projectId: spec.projectId,
    path,
    dlt: spec.dlt,
    startedAt: new Date().toISOString(),
    mode: spec.mode,
  });
  return { path, dlt: spec.dlt, active: true };
}

export async function stopCapture(
  deps: LinkDeps,
  projectId: string,
  linkId: string,
): Promise<{ path: string; sizeBytes: number; active: boolean }> {
  const project = deps.registry.get(projectId);
  const capture = project?.captures.get(linkId);
  const client = ubridgeClientFor(deps.registry, projectId);
  const runtime = project?.links.get(linkId);
  if (client && runtime) {
    if (runtime.mode === 'relay')
      await client.send(`bridge stop_capture ${runtime.bridgeName}`).catch(() => undefined);
    else {
      const anchor = runtime.anchors[0];
      if (anchor) await client.send(`capture stop_kernel ${anchor}`).catch(() => undefined);
    }
  }
  project?.captures.delete(linkId);
  const path = capture?.path ?? capturePathFor(deps.config, projectId, linkId);
  const sizeBytes = await Bun.file(path)
    .stat()
    .then((stat) => stat.size)
    .catch(() => 0);
  return { path, sizeBytes, active: false };
}

export async function captureStatus(
  deps: LinkDeps,
  projectId: string,
  linkId: string,
): Promise<{ active: boolean; path: string; sizeBytes: number; dlt: string }> {
  const capture = deps.registry.get(projectId)?.captures.get(linkId);
  const path = capture?.path ?? capturePathFor(deps.config, projectId, linkId);
  const sizeBytes = await Bun.file(path)
    .stat()
    .then((stat) => stat.size)
    .catch(() => 0);
  return { active: capture !== undefined, path, sizeBytes, dlt: capture?.dlt ?? 'DLT_EN10MB' };
}
