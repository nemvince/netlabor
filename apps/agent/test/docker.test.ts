import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { dockerVolumeSpec } from '../src/emulators/docker.ts';

describe('docker extra volumes', () => {
  test('maps a GNS3 directory path onto the node file directory', () => {
    const nodeDir = path.join('/srv/netlabor', 'project', 'nodes', 'node-1');
    expect(dockerVolumeSpec('/etc/frr', nodeDir)).toBe(`${nodeDir}/etc/frr:/etc/frr`);
  });

  test('keeps explicit Docker bind specifications unchanged', () => {
    expect(dockerVolumeSpec('/tmp/data:/data:ro', '/srv/node')).toBe('/tmp/data:/data:ro');
  });

  test('rejects relative and escaping paths', () => {
    expect(() => dockerVolumeSpec('etc/frr', '/srv/node')).toThrow('absolute');
    expect(() => dockerVolumeSpec('/../../etc', '/srv/node')).toThrow('escapes');
  });
});
