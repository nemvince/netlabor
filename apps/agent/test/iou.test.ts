import { describe, expect, test } from 'bun:test';
import { buildIouArgs, buildNetmap } from '../src/emulators/iou.ts';

describe('IOU NETMAP', () => {
  test('pads the application id to five characters', () => {
    const netmap = buildNetmap(1, 1, 0);
    // bay 0, units 0..3; `<appId+512>:<bay>/<unit><appId padded to 5>:<bay>/<unit>`
    expect(netmap.split('\n')[0]).toBe('513:0/0    1:0/0');
    expect(netmap.split('\n')[1]).toBe('513:0/1    1:0/1');
    expect(netmap.trimEnd().split('\n')).toHaveLength(64);
  });

  test('covers every IOU bay and unit regardless of adapter counts', () => {
    const netmap = buildNetmap(7, 2, 1).trimEnd().split('\n');
    expect(netmap).toHaveLength(64);
    expect(netmap[8]).toBe('519:2/0    7:2/0');
    expect(netmap[63]).toBe('519:15/3    7:15/3');
  });

  test('app id 1024 still pads', () => {
    expect(buildNetmap(1024, 1, 0).split('\n')[0]).toBe('1536:0/0 1024:0/0');
  });
});

describe('IOU argv', () => {
  test('omits defaults and appends the application id last', () => {
    expect(
      buildIouArgs({ ethernetAdapters: 2, serialAdapters: 0, ram: 256, nvram: 128 }, 5),
    ).toEqual(['5']);
  });

  test('emits adapter, serial, ram, and nvram flags when non-default', () => {
    expect(
      buildIouArgs({ ethernetAdapters: 4, serialAdapters: 2, ram: 512, nvram: 256 }, 9),
    ).toEqual(['-e', '4', '-s', '2', '-n', '256', '-m', '512', '9']);
  });

  test('loads startup-config.cfg when one is present', () => {
    expect(buildIouArgs({ ethernetAdapters: 2 }, 5, true)).toEqual([
      '-c',
      'startup-config.cfg',
      '5',
    ]);
  });
});
