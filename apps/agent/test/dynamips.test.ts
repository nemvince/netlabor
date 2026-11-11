import { describe, expect, test } from 'bun:test';
import { buildVmCommands } from '../src/emulators/dynamips.ts';
import { buildSwitchCommands } from '../src/emulators/dynamips-switch.ts';

describe('dynamips vm commands', () => {
  test('orders create, ios, resources, slots, and start', () => {
    const commands = buildVmCommands({
      name: 'R1',
      vmId: 'abc123',
      properties: {
        platform: 'c7200',
        ram: 512,
        nvram: 256,
        consoleType: 'telnet',
        slots: ['C7200-IO-FE', 'PA-4E', null, null, null, null],
        wics: ['WIC-2T'],
        npe: 'npe-400',
      },
      imagePath: '/images/c7200.bin',
      consolePort: 20000,
      auxPort: 30001,
      nvramPath: '/nodes/r1/nvram',
      diskPath: '/nodes/r1/disk0',
    });
    expect(commands[0]).toContain('vm create "R1" abc123 c7200');
    expect(commands[1]).toContain('vm set_ios "R1" "/images/c7200.bin"');
    expect(commands).toContain('vm set_aux_tcp_port "R1" 30001');
    expect(commands).toContain('vm slot_add_binding "R1" 1 0 PA-4E');
    expect(commands).toContain('vm slot_add_binding "R1" 0 1 WIC-2T');
    expect(commands).toContain('vm set_npe "R1" npe-400');
    expect(commands.at(-1)).toBe('vm start "R1"');
  });
});

describe('ATM and frame relay switches', () => {
  const nio = (port: number) => `nio_udp:${50000 + port}:127.0.0.1:6000${port}`;

  test('creates both directions for frame relay DLCI mappings', () => {
    const commands = buildSwitchCommands('frame_relay_switch', 'FR1', [['1:100', '2:200']], nio);
    expect(commands).toHaveLength(2);
    expect(commands[0]).toBe(
      'frsw create_vc "FR1" nio_udp:50001:127.0.0.1:60001 100 nio_udp:50002:127.0.0.1:60002 200',
    );
    expect(commands[1]).toContain(
      'nio_udp:50002:127.0.0.1:60002 200 nio_udp:50001:127.0.0.1:60001 100',
    );
  });

  test('creates VCC pairs and VPC for two-field ATM keys', () => {
    const vcc = buildSwitchCommands('atm_switch', 'A1', [['1:0:100', '2:0:200']], nio);
    expect(vcc).toHaveLength(2);
    expect(vcc[0]).toBe(
      'atmsw create_vcc "A1" nio_udp:50001:127.0.0.1:60001 0 100 nio_udp:50002:127.0.0.1:60002 0 200',
    );
    const vpc = buildSwitchCommands('atm_switch', 'A1', [['1:5', '2:6']], nio);
    expect(vpc[0]).toBe(
      'atmsw create_vpc "A1" nio_udp:50001:127.0.0.1:60001 5 nio_udp:50002:127.0.0.1:60002 6',
    );
  });
});
