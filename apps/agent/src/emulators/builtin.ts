/** Builtin nodes: Ethernet switch, hub, Cloud, and NAT. */

import { anchorHash } from '@netlabor/catalog/anchors';
import { type AgentPortSpec, AppError } from '@netlabor/contract';
import { createLogger } from '@netlabor/shared';
import type { AgentConfig } from '../config.ts';
import {
  type NodeAdapter,
  type NodeContext,
  type NodeStartResult,
  registerAdapter,
} from '../dataplane/node.ts';
import { ubridgeClientFor } from '../dataplane/project.ts';
import type { ProjectRegistry } from '../state.ts';
import { run, runInNetns } from '../sys.ts';
import { UbridgeError } from '../ubridge/client.ts';

const logger = createLogger({ service: 'agent-builtin' });

interface BuiltinRuntime {
  bridge: string;
  interfaces: string[];
}

const runtime = new WeakMap<ProjectRegistry, Map<string, BuiltinRuntime>>();

function runtimes(registry: ProjectRegistry): Map<string, BuiltinRuntime> {
  let map = runtime.get(registry);
  if (!map) {
    map = new Map();
    runtime.set(registry, map);
  }
  return map;
}

function bridgeNameFor(nodeType: string, nodeId: string): string {
  // Hash the node ID: UUIDv7 prefixes collide for nodes created together.
  const prefix = nodeType === 'ethernet_hub' ? 'hb' : 'sw';
  const hash = new Bun.CryptoHasher('sha256').update(nodeId).digest('hex').slice(0, 10);
  return `${prefix}${hash}`;
}

function mappingFor(ctx: NodeContext, port: AgentPortSpec): Record<string, unknown> {
  const mapping = ctx.spec.properties.portsMapping;
  if (!Array.isArray(mapping)) return {};
  const entry = mapping.find((item, index) => {
    if (!item || typeof item !== 'object') return false;
    const portNumber = 'portNumber' in item ? Number(item.portNumber) : index;
    return portNumber === port.port;
  });
  return entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
}

async function createBridge(ctx: NodeContext, name: string): Promise<void> {
  const client = ubridgeClientFor(ctx.registry, ctx.spec.projectId);
  if (!client) throw new AppError('AGENT_ERROR', 'project ubridge is not running');
  // ubridge's brctl creates the kernel bridge itself.
  try {
    await client.send(`brctl create ${name}`);
  } catch (error) {
    const text = error instanceof UbridgeError ? error.payload.join(' ') : String(error);
    if (!/File exists/i.test(text)) {
      logger.error('builtin bridge creation failed', {
        bridge: name,
        nodeId: ctx.spec.nodeId,
        code: error instanceof UbridgeError ? error.code : null,
        payload: error instanceof UbridgeError ? error.payload : null,
        err: error,
      });
      throw error;
    }
    logger.debug('builtin bridge already exists', { bridge: name, nodeId: ctx.spec.nodeId });
  }
  await runInNetns(ctx.netns, ['ip', 'link', 'set', name, 'up']);
}

async function createPortPair(
  ctx: NodeContext,
  port: AgentPortSpec,
  bridge: string,
): Promise<string> {
  const hash = anchorHash(ctx.spec.nodeId, port.adapter, port.port);
  const hostEnd = `sp${hash}p`;
  const peerEnd = `sp${hash}l`;
  await runInNetns(ctx.netns, [
    'ip',
    'link',
    'add',
    hostEnd,
    'type',
    'veth',
    'peer',
    'name',
    peerEnd,
  ]);
  await runInNetns(ctx.netns, ['ip', 'link', 'set', hostEnd, 'master', bridge]);
  await runInNetns(ctx.netns, ['ip', 'link', 'set', hostEnd, 'up']);
  await runInNetns(ctx.netns, ['ip', 'link', 'set', peerEnd, 'up']);
  return peerEnd;
}

async function configureSwitchVlans(ctx: NodeContext, bridge: string): Promise<void> {
  const client = ubridgeClientFor(ctx.registry, ctx.spec.projectId);
  if (!client) return;
  try {
    await configureSwitchVlanCommands(ctx, bridge, client);
  } catch (error) {
    if (error instanceof UbridgeError) {
      throw new AppError('AGENT_ERROR', `switch VLAN configuration failed: ${error.message}`, {
        details: error.payload.join(' '),
      });
    }
    throw error;
  }
}

async function configureSwitchVlanCommands(
  ctx: NodeContext,
  bridge: string,
  client: NonNullable<ReturnType<typeof ubridgeClientFor>>,
): Promise<void> {
  const ports = ctx.spec.ports;
  const anyVlan = ports.some((port) => {
    const mapping = mappingFor(ctx, port);
    return mapping.type === 'access' || mapping.type === 'dot1q' || mapping.type === 'qinq';
  });
  if (!anyVlan) return;

  await client.send(`brctl vlanfiltering ${bridge} on`).catch(() => undefined);
  for (const port of ports) {
    const index = `sp${anchorHash(ctx.spec.nodeId, port.adapter, port.port)}p`;
    const mapping = mappingFor(ctx, port);
    // The default PVID 1 is not cleaned automatically by brctl.
    await client.send(`brctl vlan_del ${bridge} ${index} 1`).catch(() => undefined);
    const type = typeof mapping.type === 'string' ? mapping.type : 'access';
    if (type === 'access') {
      const vlan = Number(mapping.vlan ?? 1);
      await client.send(`brctl vlan_add ${bridge} ${index} ${vlan} pvid untagged`);
      continue;
    }
    if (type === 'dot1q') {
      const native =
        mapping.nativeVlan === null || mapping.nativeVlan === undefined
          ? null
          : Number(mapping.nativeVlan);
      const tagged = Array.isArray(mapping.taggedVlans)
        ? (mapping.taggedVlans as unknown[]).map((value) => Number(value))
        : [];
      for (const vlan of tagged) {
        await client.send(`brctl vlan_add ${bridge} ${index} ${vlan}`);
      }
      if (native !== null)
        await client.send(`brctl vlan_add ${bridge} ${index} ${native} pvid untagged`);
      continue;
    }
    // qinq: outer S-VLAN tagged, only 0x8100/0x88a8 supported.
    const ethertype = typeof mapping.ethertype === 'string' ? mapping.ethertype : '0x88a8';
    if (ethertype !== '0x8100' && ethertype !== '0x88a8') {
      throw new AppError('CAPABILITY_UNSUPPORTED', `ethertype ${ethertype} is not supported`);
    }
    await client.send(`brctl setvlanproto ${bridge} ${ethertype}`).catch(() => undefined);
    const outer = Number(mapping.vlan ?? 1);
    await client.send(`brctl vlan_add ${bridge} ${index} ${outer}`);
  }
}

const switchAdapter: NodeAdapter = {
  nodeType: 'ethernet_switch',

  async create(): Promise<void> {},

  async start(ctx: NodeContext): Promise<NodeStartResult> {
    const bridge = bridgeNameFor('ethernet_switch', ctx.spec.nodeId);
    await createBridge(ctx, bridge);
    const interfaces: string[] = [];
    for (const port of ctx.spec.ports) {
      interfaces.push(await createPortPair(ctx, port, bridge));
    }
    await configureSwitchVlans(ctx, bridge);
    runtimes(ctx.registry).set(ctx.spec.nodeId, { bridge, interfaces });
    return { pid: null, internalConsolePort: null, internalVncPort: null };
  },

  async stop(ctx: NodeContext): Promise<void> {
    const state = runtimes(ctx.registry).get(ctx.spec.nodeId);
    if (!state) return;
    for (const iface of state.interfaces) {
      await runInNetns(ctx.netns, ['ip', 'link', 'delete', iface], { allowFailure: true });
    }
    await runInNetns(ctx.netns, ['ip', 'link', 'delete', state.bridge], { allowFailure: true });
    runtimes(ctx.registry).delete(ctx.spec.nodeId);
  },
};

const hubAdapter: NodeAdapter = {
  nodeType: 'ethernet_hub',

  async create(): Promise<void> {},

  async start(ctx: NodeContext): Promise<NodeStartResult> {
    const bridge = bridgeNameFor('ethernet_hub', ctx.spec.nodeId);
    await createBridge(ctx, bridge);
    await runInNetns(
      ctx.netns,
      ['ip', 'link', 'set', bridge, 'type', 'bridge', 'ageing_time', '0'],
      {
        allowFailure: true,
      },
    );
    const interfaces: string[] = [];
    for (const port of ctx.spec.ports) {
      const peer = await createPortPair(ctx, port, bridge);
      const host = `sp${anchorHash(ctx.spec.nodeId, port.adapter, port.port)}p`;
      const result = await runInNetns(
        ctx.netns,
        ['ip', 'link', 'set', host, 'type', 'bridge_slave', 'learning', 'off'],
        { allowFailure: true },
      );
      if (result.code !== 0) {
        throw new AppError(
          'CAPABILITY_UNSUPPORTED',
          'kernel bridge ports cannot disable learning',
          {
            details: result.stderr.trim(),
          },
        );
      }
      interfaces.push(peer);
    }
    runtimes(ctx.registry).set(ctx.spec.nodeId, { bridge, interfaces });
    return { pid: null, internalConsolePort: null, internalVncPort: null };
  },

  async stop(ctx: NodeContext): Promise<void> {
    const state = runtimes(ctx.registry).get(ctx.spec.nodeId);
    if (!state) return;
    for (const iface of state.interfaces) {
      await runInNetns(ctx.netns, ['ip', 'link', 'delete', iface], { allowFailure: true });
    }
    await runInNetns(ctx.netns, ['ip', 'link', 'delete', state.bridge], { allowFailure: true });
    runtimes(ctx.registry).delete(ctx.spec.nodeId);
  },
};

async function isHostBridge(name: string): Promise<boolean> {
  const result = await run(['ls', `/sys/class/net/${name}/bridge`], { allowFailure: true });
  return result.code === 0;
}

async function connectCloudPort(
  config: AgentConfig,
  ctx: NodeContext,
  port: AgentPortSpec,
  mapping: Record<string, unknown>,
): Promise<string | null> {
  const hostInterface = typeof mapping.interface === 'string' ? mapping.interface : null;
  if (!hostInterface) return null;
  if (config.cloudInterfaces.length > 0 && !config.cloudInterfaces.includes(hostInterface)) {
    throw new AppError('FORBIDDEN', `interface ${hostInterface} is not in NB_CLOUD_INTERFACES`);
  }
  const hash = anchorHash(ctx.spec.nodeId, port.adapter, port.port);
  const nsName = `c${hash}`;

  if (await isHostBridge(hostInterface)) {
    const hostEnd = `cl${hash}h`;
    const peerEnd = `cl${hash}p`;
    await run(['ip', 'link', 'add', hostEnd, 'type', 'veth', 'peer', 'name', peerEnd]);
    await run(['ip', 'link', 'set', hostEnd, 'master', hostInterface]);
    await run(['ip', 'link', 'set', hostEnd, 'up']);
    await run(['ip', 'link', 'set', peerEnd, 'netns', ctx.netns]);
    await runInNetns(ctx.netns, ['ip', 'link', 'set', peerEnd, 'name', nsName]);
    await runInNetns(ctx.netns, ['ip', 'link', 'set', nsName, 'up']);
    return nsName;
  }

  // Physical interface: bridge through a macvlan in the namespace.
  const temp = `cl${hash}m`;
  await run([
    'ip',
    'link',
    'add',
    'link',
    hostInterface,
    'name',
    temp,
    'type',
    'macvlan',
    'mode',
    'bridge',
  ]);
  await run(['ip', 'link', 'set', temp, 'netns', ctx.netns]);
  await runInNetns(ctx.netns, ['ip', 'link', 'set', temp, 'name', nsName]);
  await runInNetns(ctx.netns, ['ip', 'link', 'set', nsName, 'up']);
  return nsName;
}

const cloudAdapter: NodeAdapter = {
  nodeType: 'cloud',

  async create(): Promise<void> {},

  async start(ctx: NodeContext): Promise<NodeStartResult> {
    const interfaces: string[] = [];
    for (const port of ctx.spec.ports) {
      const mapping = mappingFor(ctx, port);
      if (mapping.type === 'udp') continue;
      const iface = await connectCloudPort(ctx.config, ctx, port, mapping);
      if (iface) interfaces.push(iface);
    }
    runtimes(ctx.registry).set(ctx.spec.nodeId, { bridge: '', interfaces });
    return { pid: null, internalConsolePort: null, internalVncPort: null };
  },

  async stop(ctx: NodeContext): Promise<void> {
    const state = runtimes(ctx.registry).get(ctx.spec.nodeId);
    if (!state) return;
    for (const iface of state.interfaces) {
      await runInNetns(ctx.netns, ['ip', 'link', 'delete', iface], { allowFailure: true });
    }
    runtimes(ctx.registry).delete(ctx.spec.nodeId);
  },
};

const natAdapter: NodeAdapter = {
  nodeType: 'nat',

  async create(): Promise<void> {},

  async start(ctx: NodeContext): Promise<NodeStartResult> {
    const bridgeCheck = await run(['ip', 'link', 'show', ctx.config.natBridge], {
      allowFailure: true,
    });
    if (bridgeCheck.code !== 0) {
      throw new AppError(
        'CAPABILITY_UNSUPPORTED',
        `NAT bridge ${ctx.config.natBridge} is missing; provision it on the compute or set NB_NAT_BRIDGE`,
        { details: 'scripts/provision-nat-bridge.sh creates a DHCP/NAT bridge for local labs.' },
      );
    }
    const interfaces: string[] = [];
    for (const port of ctx.spec.ports) {
      const hash = anchorHash(ctx.spec.nodeId, port.adapter, port.port);
      const hostEnd = `nt${hash}h`;
      const peerEnd = `nt${hash}p`;
      const nsName = `c${hash}`;
      await run(['ip', 'link', 'add', hostEnd, 'type', 'veth', 'peer', 'name', peerEnd]);
      await run(['ip', 'link', 'set', hostEnd, 'master', ctx.config.natBridge]);
      await run(['ip', 'link', 'set', hostEnd, 'up']);
      await run(['ip', 'link', 'set', peerEnd, 'netns', ctx.netns]);
      await runInNetns(ctx.netns, ['ip', 'link', 'set', peerEnd, 'name', nsName]);
      await runInNetns(ctx.netns, ['ip', 'link', 'set', nsName, 'up']);
      interfaces.push(nsName);
    }
    runtimes(ctx.registry).set(ctx.spec.nodeId, { bridge: ctx.config.natBridge, interfaces });
    return { pid: null, internalConsolePort: null, internalVncPort: null };
  },

  async stop(ctx: NodeContext): Promise<void> {
    const state = runtimes(ctx.registry).get(ctx.spec.nodeId);
    if (!state) return;
    for (const iface of state.interfaces) {
      await runInNetns(ctx.netns, ['ip', 'link', 'delete', iface], { allowFailure: true });
    }
    runtimes(ctx.registry).delete(ctx.spec.nodeId);
  },
};

export function registerBuiltinAdapters(): void {
  registerAdapter(switchAdapter);
  registerAdapter(hubAdapter);
  registerAdapter(cloudAdapter);
  registerAdapter(natAdapter);
}

export function builtinInterfaces(registry: ProjectRegistry, nodeId: string): string[] {
  return runtimes(registry).get(nodeId)?.interfaces ?? [];
}
