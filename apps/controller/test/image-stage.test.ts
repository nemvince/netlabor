import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AppDeps } from '../src/implementer.ts';
import { stageBlob } from '../src/services/images.ts';

const root = await mkdtemp(path.join(tmpdir(), 'netlabor-stage-'));
afterAll(() => rm(root, { recursive: true, force: true }));

function deps(storageDriver: 'local' | 'nfs', nfsImageDir: string | null): AppDeps {
  return {
    config: {
      stagingDir: path.join(root, 'staging'),
      storageDriver,
      nfsImageDir,
    },
  } as unknown as AppDeps;
}

const sha = 'a'.repeat(64);

describe('stageBlob permissions', () => {
  test('makes a controller-staged blob readable by computes', async () => {
    const part = path.join(root, 'part');
    await writeFile(part, 'image', { mode: 0o600 });
    const target = await stageBlob(deps('local', null), part, sha, 'disk.img');
    expect((await stat(target)).mode & 0o777).toBe(0o644);
  });

  test('makes an NFS blob readable by the emulator account', async () => {
    const nfs = path.join(root, 'nfs');
    await mkdir(nfs, { recursive: true });
    const part = path.join(root, 'part-nfs');
    await writeFile(part, 'image', { mode: 0o600 });
    const target = await stageBlob(deps('nfs', nfs), part, sha, 'disk-nfs.img');
    expect((await stat(target)).mode & 0o777).toBe(0o644);
  });
});
