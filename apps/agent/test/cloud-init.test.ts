import { describe, expect, test } from 'bun:test';
import { cloudInitSeed } from '../src/emulators/cloud-init.ts';

function context(properties: Record<string, unknown>) {
  return {
    spec: { name: 'snh-lg', nodeId: 'node-1', properties },
  } as Parameters<typeof cloudInitSeed>[0];
}

describe('cloud-init seed content', () => {
  test('generates a seed from the basic fields', () => {
    const seed = cloudInitSeed(context({ cloudInitUser: 'railink' }));
    expect(seed.userData.startsWith('#cloud-config\n')).toBe(true);
    expect(seed.userData).toContain('name: "railink"');
    expect(seed.networkConfig).toContain('dhcp4: true');
    expect(seed.metaData).toMatch(/^instance-id: node-1-[0-9a-f]{12}\n/);
  });

  test('verbatim user-data and network-config override the generated files', () => {
    const seed = cloudInitSeed(
      context({
        cloudInitUserData: '#cloud-config\nhostname: custom\n',
        cloudInitNetworkConfig: 'version: 2\nethernets:\n  eth1:\n    dhcp4: true\n',
      }),
    );
    expect(seed.userData).toBe('#cloud-config\nhostname: custom\n');
    expect(seed.networkConfig).toContain('eth1:');
    expect(seed.metaData).toMatch(/^instance-id: node-1-[0-9a-f]{12}\n/);
  });

  test('a changed custom user-data changes the instance-id', () => {
    const first = cloudInitSeed(context({ cloudInitUserData: '#cloud-config\na: 1\n' }));
    const second = cloudInitSeed(context({ cloudInitUserData: '#cloud-config\na: 2\n' }));
    expect(first.metaData).not.toBe(second.metaData);
  });

  test('custom meta-data is used without synthesising an instance-id', () => {
    const seed = cloudInitSeed(
      context({ cloudInitUserData: '#cloud-config\n', cloudInitMetaData: 'instance-id: fixed\n' }),
    );
    expect(seed.metaData).toBe('instance-id: fixed\n');
  });
});
