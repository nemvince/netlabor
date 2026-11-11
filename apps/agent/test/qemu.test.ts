import { describe, expect, test } from 'bun:test';
import { defaultMac } from '../src/emulators/qemu.ts';

describe('QEMU default MACs', () => {
  test('encode the adapter number in the last octet', () => {
    for (const adapter of [0, 1, 2, 9, 15]) {
      const mac = defaultMac('node-1', adapter);
      expect(mac.split(':').pop()).toBe(adapter.toString(16).padStart(2, '0'));
    }
  });

  test('are stable for a node and differ between nodes', () => {
    expect(defaultMac('node-1', 3)).toBe(defaultMac('node-1', 3));
    expect(defaultMac('node-1', 3)).not.toBe(defaultMac('node-2', 3));
  });
});
