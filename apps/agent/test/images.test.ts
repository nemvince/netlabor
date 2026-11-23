import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentConfig } from '../src/config.ts';
import { ensureImage } from '../src/storage/images.ts';

const root = await mkdtemp(path.join(tmpdir(), 'netlabor-images-'));
afterAll(() => rm(root, { recursive: true, force: true }));

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function config(imageDir: string): AgentConfig {
  return {
    imageDir,
    nfsImageDir: null,
    storageDriver: 'local',
  } as unknown as AgentConfig;
}

describe('ensureImage verification cache', () => {
  test('re-hashes after the file changes instead of trusting a stale digest', async () => {
    const content = 'abc';
    const digest = sha256(content);
    const file = path.join(root, digest, 'disk.img');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);

    const input = {
      sha256: digest,
      filename: 'disk.img',
      source: { type: 'present' as const },
    };
    await expect(ensureImage(config(root), input)).resolves.toMatchObject({ sha256: digest });

    await writeFile(file, 'abd');
    const later = new Date(Date.now() + 5_000);
    await utimes(file, later, later);

    await expect(ensureImage(config(root), input)).rejects.toMatchObject({
      code: 'IMAGE_MISSING',
    });
  });
});
