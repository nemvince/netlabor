/** ATM and frame-relay switches backed by Dynamips devices. */

import { AppError } from '@netlabor/contract';
import {
  type NodeAdapter,
  type NodeContext,
  type NodeStartResult,
  registerAdapter,
} from '../dataplane/node.ts';
import type { ProjectRegistry } from '../state.ts';
import { ensureHypervisor } from './dynamips.ts';

interface SwitchRuntime {
  name: string;
  connections: string[];
}

const runtimes = new WeakMap<ProjectRegistry, Map<string, SwitchRuntime>>();

function mapFor(registry: ProjectRegistry): Map<string, SwitchRuntime> {
  let map = runtimes.get(registry);
  if (!map) {
    map = new Map();
    runtimes.set(registry, map);
  }
  return map;
}

function parseMappings(properties: Record<string, unknown>): [string, string][] {
  const mappings = properties.mappings;
  if (!mappings || typeof mappings !== 'object') return [];
  return Object.entries(mappings as Record<string, string>).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
}

function parseAtmKey(key: string): { port: number; vpi: number; vci: number | null } | null {
  const parts = key.split(':').map((value) => Number(value));
  const [port, vpi, vci] = parts;
  if (port === undefined || vpi === undefined) return null;
  return { port, vpi, vci: vci ?? null };
}

function parseFrameRelayKey(key: string): { port: number; dlci: number } | null {
  const parts = key.split(':').map((value) => Number(value));
  const [port, dlci] = parts;
  if (port === undefined || dlci === undefined) return null;
  return { port, dlci };
}

/** Build the switch's connection commands (exported for tests). */
export function buildSwitchCommands(
  nodeType: string,
  name: string,
  mappings: [string, string][],
  nioForPort: (port: number) => string,
): string[] {
  const commands: string[] = [];
  if (nodeType === 'atm_switch') {
    for (const [keyA, keyB] of mappings) {
      const a = parseAtmKey(keyA);
      const b = parseAtmKey(keyB);
      if (!a || !b) continue;
      const nioA = nioForPort(a.port);
      const nioB = nioForPort(b.port);
      if (a.vci === null || b.vci === null) {
        commands.push(`atmsw create_vpc "${name}" ${nioA} ${a.vpi} ${nioB} ${b.vpi}`);
      } else {
        commands.push(
          `atmsw create_vcc "${name}" ${nioA} ${a.vpi} ${a.vci} ${nioB} ${b.vpi} ${b.vci}`,
        );
        commands.push(
          `atmsw create_vcc "${name}" ${nioB} ${b.vpi} ${b.vci} ${nioA} ${a.vpi} ${a.vci}`,
        );
      }
    }
    return commands;
  }
  for (const [keyA, keyB] of mappings) {
    const a = parseFrameRelayKey(keyA);
    const b = parseFrameRelayKey(keyB);
    if (!a || !b) continue;
    const nioA = nioForPort(a.port);
    const nioB = nioForPort(b.port);
    commands.push(`frsw create_vc "${name}" ${nioA} ${a.dlci} ${nioB} ${b.dlci}`);
    commands.push(`frsw create_vc "${name}" ${nioB} ${b.dlci} ${nioA} ${a.dlci}`);
  }
  return commands;
}

function switchAdapter(nodeType: 'atm_switch' | 'frame_relay_switch'): NodeAdapter {
  return {
    nodeType,

    async create(): Promise<void> {},

    async start(ctx: NodeContext): Promise<NodeStartResult> {
      const hypervisor = await ensureHypervisor(ctx);
      const name = ctx.spec.name;
      const createCommand = nodeType === 'atm_switch' ? 'atmsw create' : 'frsw create';
      const mappings = parseMappings(ctx.spec.properties);
      const portNios = new Map<number, string>();
      for (const [key] of mappings) {
        const port = Number(key.split(':')[0]);
        if (!Number.isInteger(port) || portNios.has(port)) continue;
        const lport = ctx.registry.allocateInternalPort(ctx.spec.projectId, 23000);
        portNios.set(port, `nio_udp:${lport}:127.0.0.1:0`);
      }
      await hypervisor.client.send(`${createCommand} "${name}"`).catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('exists')) throw error;
      });
      const commands = buildSwitchCommands(
        nodeType,
        name,
        mappings,
        (port) => portNios.get(port) ?? '',
      );
      for (const command of commands) {
        if (command.endsWith(' ')) continue;
        await hypervisor.client.send(command);
      }
      mapFor(ctx.registry).set(ctx.spec.nodeId, {
        name,
        connections: [...portNios.values()],
      });
      return { pid: hypervisor.pid, internalConsolePort: null, internalVncPort: null };
    },

    async stop(ctx: NodeContext): Promise<void> {
      const state = mapFor(ctx.registry).get(ctx.spec.nodeId);
      const hypervisor = await ensureHypervisor(ctx).catch(() => null);
      if (hypervisor && state) {
        const deleteCommand = nodeType === 'atm_switch' ? 'atmsw delete' : 'frsw delete';
        await hypervisor.client.send(`${deleteCommand} "${state.name}"`).catch(() => undefined);
      }
      mapFor(ctx.registry).delete(ctx.spec.nodeId);
    },

    async delete(): Promise<void> {},
  };
}

export function registerDynamipsSwitchAdapters(): void {
  try {
    registerAdapter(switchAdapter('atm_switch'));
    registerAdapter(switchAdapter('frame_relay_switch'));
  } catch (error) {
    throw new AppError('AGENT_ERROR', 'failed to register switch adapters', {
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
