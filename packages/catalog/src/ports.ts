/** Derived port maps per node type. The UI never guesses ports. */

import type { NodePort, NodeType } from '@netlabor/contract';

const DEFAULT_PREFIX = 'Ethernet';

function label(format: string | undefined, index: number, first: string | undefined): string {
  if (!format) return `${first ?? DEFAULT_PREFIX}${index}`;
  return format
    .replace(/%(0?)(\d*)d/g, (_match, zero: string, width: string) =>
      String(index).padStart(zero === '0' ? Number(width || 1) : Number(width || 0), '0'),
    )
    .replaceAll('{0}', String(index));
}

/**
 * Ports a node exposes, from its properties. Mirrors the adapters the agent
 * will create; link creation validates against this list.
 */
export function portsForNode(nodeType: NodeType, properties: Record<string, unknown>): NodePort[] {
  const firstPortName =
    typeof properties.firstPortName === 'string' ? properties.firstPortName : undefined;
  const portNameFormat =
    typeof properties.portNameFormat === 'string' ? properties.portNameFormat : undefined;

  switch (nodeType) {
    case 'vpcs':
      return [
        {
          adapter: 0,
          port: 0,
          name: label(portNameFormat, 0, firstPortName) || 'Ethernet0',
          type: 'ethernet',
        },
      ];

    case 'qemu':
    case 'docker': {
      const adapters = Number(properties.adapters ?? 1);
      const ports: NodePort[] = [];
      for (let index = 0; index < adapters; index++) {
        ports.push({
          adapter: index,
          port: 0,
          name: label(portNameFormat, index, firstPortName) || `Ethernet${index}`,
          type: 'ethernet',
        });
      }
      return ports;
    }

    case 'iou': {
      const ethernet = Number(properties.ethernetAdapters ?? 2);
      const serial = Number(properties.serialAdapters ?? 0);
      const ports: NodePort[] = [];
      for (let bay = 0; bay < ethernet; bay++) {
        for (let unit = 0; unit < 4; unit++) {
          ports.push({
            adapter: bay,
            port: unit,
            name: `Ethernet${bay}/${unit}`,
            type: 'ethernet',
          });
        }
      }
      for (let bay = 0; bay < serial; bay++) {
        for (let unit = 0; unit < 4; unit++) {
          ports.push({
            adapter: ethernet + bay,
            port: unit,
            name: `Serial${bay}/${unit}`,
            type: 'serial',
          });
        }
      }
      return ports;
    }

    case 'dynamips': {
      const slots = Array.isArray(properties.slots) ? (properties.slots as (string | null)[]) : [];
      const wics = Array.isArray(properties.wics) ? (properties.wics as (string | null)[]) : [];
      const ports: NodePort[] = [];
      slots.forEach((adapterType, slotIndex) => {
        const count = dynamipsAdapterPorts(adapterType);
        for (let port = 0; port < count; port++) {
          ports.push({
            adapter: slotIndex,
            port,
            name: `Slot${slotIndex}/${port}`,
            type: 'ethernet',
            ...(adapterType ? { adapterType } : {}),
          });
        }
      });
      wics.forEach((adapterType, wicIndex) => {
        const count = dynamipsAdapterPorts(adapterType);
        for (let port = 0; port < count; port++) {
          ports.push({
            adapter: 0,
            port: port + wicIndex * 2,
            name: `WIC${wicIndex}/${port}`,
            type: 'serial',
            ...(adapterType ? { adapterType } : {}),
          });
        }
      });
      return ports;
    }

    case 'cloud': {
      const mapping = Array.isArray(properties.portsMapping)
        ? (properties.portsMapping as { name?: string; type?: string }[])
        : [];
      return mapping.map((entry, index) => ({
        adapter: 0,
        port: index,
        name: entry.name ?? `port${index}`,
        type: entry.type === 'tap' || entry.type === 'udp' ? 'ethernet' : 'ethernet',
      }));
    }

    case 'nat':
      return [{ adapter: 0, port: 0, name: 'nat0', type: 'ethernet' }];

    case 'ethernet_switch':
    case 'ethernet_hub': {
      const mapping = Array.isArray(properties.portsMapping)
        ? (properties.portsMapping as { name?: string; portNumber?: number }[])
        : [];
      if (mapping.length === 0) {
        const count = Number(properties.ports ?? 8);
        return Array.from({ length: count }, (_value, index) => ({
          adapter: 0,
          port: index,
          name: `Ethernet${index}`,
          type: 'ethernet' as const,
        }));
      }
      return mapping.map((entry, index) => ({
        adapter: 0,
        port: entry.portNumber ?? index,
        name: entry.name ?? `Ethernet${index}`,
        type: 'ethernet' as const,
      }));
    }

    case 'atm_switch':
    case 'frame_relay_switch': {
      const mappings =
        properties.mappings && typeof properties.mappings === 'object'
          ? Object.keys(properties.mappings as Record<string, string>)
          : [];
      const portNumbers = new Set<number>();
      for (const key of mappings) {
        const port = Number(key.split(':')[0]);
        if (Number.isInteger(port)) portNumbers.add(port);
      }
      return [...portNumbers]
        .sort((a, b) => a - b)
        .map((port) => ({
          adapter: 0,
          port,
          name: `Port${port}`,
          type: nodeType === 'atm_switch' ? ('atm' as const) : ('frame_relay' as const),
        }));
    }
  }
}

/** Port counts for Dynamips adapters (GbE/FA ports or serial ports). */
export function dynamipsAdapterPorts(adapterType: string | null | undefined): number {
  if (!adapterType) return 0;
  if (adapterType.startsWith('NM-') || adapterType.startsWith('PA-')) {
    if (/4E|4T/.test(adapterType)) return 4;
    if (/8E|8T/.test(adapterType)) return 8;
    if (/2E|2T|2W/.test(adapterType)) return 2;
    if (/1E|1T/.test(adapterType)) return 1;
    if (/16ES/.test(adapterType)) return 16;
    if (/C7200-IO/.test(adapterType)) return 1;
  }
  if (adapterType === 'WIC-1T' || adapterType === 'WIC-1B-S/T') return 1;
  if (adapterType === 'WIC-2T' || adapterType === 'WIC-2A/S') return 2;
  return 0;
}
