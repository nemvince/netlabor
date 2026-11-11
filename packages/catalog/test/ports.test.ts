import { describe, expect, test } from 'bun:test';
import { anchorHash, anchorNames, linkBridgeName } from '../src/anchors.ts';
import { dynamipsAdapterPorts, portsForNode } from '../src/ports.ts';

describe('port derivation', () => {
  test('vpcs exposes one ethernet port', () => {
    expect(portsForNode('vpcs', {})).toEqual([
      { adapter: 0, port: 0, name: 'Ethernet0', type: 'ethernet' },
    ]);
  });

  test('switch defaults to eight ports and honours explicit mappings', () => {
    expect(portsForNode('ethernet_switch', {})).toHaveLength(8);
    const mapped = portsForNode('ethernet_switch', {
      portsMapping: [{ name: 'Gi0/1', portNumber: 0, type: 'access', vlan: 10 }],
    });
    expect(mapped).toEqual([{ adapter: 0, port: 0, name: 'Gi0/1', type: 'ethernet' }]);
  });

  test('qemu adapters and iou bays derive correct port counts', () => {
    expect(portsForNode('qemu', { adapters: 3 })).toHaveLength(3);
    const iou = portsForNode('iou', { ethernetAdapters: 2, serialAdapters: 1 });
    expect(iou.filter((port) => port.type === 'ethernet')).toHaveLength(8);
    expect(iou.filter((port) => port.type === 'serial')).toHaveLength(4);
    expect(iou.find((port) => port.type === 'serial')?.adapter).toBe(2);
  });

  test('dynamips ports follow slot and WIC adapters', () => {
    expect(dynamipsAdapterPorts('PA-4E')).toBe(4);
    expect(dynamipsAdapterPorts('NM-16ESW')).toBe(16);
    const ports = portsForNode('dynamips', { slots: ['C7200-IO-FE', 'PA-4E'], wics: ['WIC-2T'] });
    expect(ports.filter((port) => port.adapter === 1)).toHaveLength(4);
    expect(ports.filter((port) => port.name.startsWith('WIC'))).toHaveLength(2);
  });
});

describe('anchor names', () => {
  test('are deterministic and short enough for Linux', () => {
    const names = anchorNames('ethernet_switch', '11111111-2222-4333-8444-555555555555', 0, 3);
    expect(names.interfaceName).toBe(
      `sp${anchorHash('11111111-2222-4333-8444-555555555555', 0, 3)}l`,
    );
    expect((names.interfaceName ?? '').length).toBeLessThanOrEqual(15);
    expect((names.bridgeName ?? '').length).toBeLessThanOrEqual(15);
    expect(linkBridgeName('11111111-2222-4333-8444-555555555555')).toHaveLength(12);
  });

  test('qemu uses an emulator TAP, vpcs has no kernel interface', () => {
    expect(anchorNames('qemu', 'n1', 0, 0).tapName).toMatch(/^t[0-9a-f]{10}$/);
    expect(anchorNames('vpcs', 'n1', 0, 0).interfaceName).toBeNull();
  });
});
