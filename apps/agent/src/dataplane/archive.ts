/** Project directory archives: tar.gz export, import, snapshot, restore. */

import { once } from 'node:events';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, gunzipSync, gzipSync } from 'node:zlib';
import { AppError } from '@netlabor/contract';
import { resolveWithin } from '@netlabor/shared';
import tar from 'tar-stream';
import type { AgentConfig } from '../config.ts';
import { projectDir } from './project.ts';

const EXCLUDED = new Set(['captures']);

/** Tar+gzip a project directory, skipping captures (never part of archives). */
export async function archiveProject(config: AgentConfig, projectId: string): Promise<Uint8Array> {
  const root = projectDir(config, projectId);
  if (!(await Bun.file(path.join(root, 'meta.json')).exists())) {
    throw new AppError('NOT_FOUND', 'project directory not found on this compute');
  }
  const pack = tar.pack();
  const chunks: Buffer[] = [];
  pack.on('data', (chunk: unknown) => chunks.push(Buffer.from(chunk as Uint8Array)));
  const finished = once(pack, 'end');

  const addDirectory = async (relative: string) => {
    const absolute = relative === '' ? root : path.join(root, relative);
    const entries = await readEntries(absolute);
    for (const entry of entries) {
      const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (EXCLUDED.has(entry.name) && relative === '') continue;
      if (entry.isDirectory()) {
        await addDirectory(childRelative);
        continue;
      }
      if (!entry.isFile()) continue;
      const file = Bun.file(path.join(root, childRelative));
      const data = new Uint8Array(await file.arrayBuffer());
      await new Promise<void>((resolve, reject) => {
        pack.entry({ name: childRelative, size: data.byteLength, mode: 0o644 }, data, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  };

  try {
    await addDirectory('');
  } finally {
    pack.finalize();
  }
  await finished;
  return new Uint8Array(gzipSync(Buffer.concat(chunks), { level: 6 }));
}

async function readEntries(directory: string) {
  const { readdir } = await import('node:fs/promises');
  return readdir(directory, { withFileTypes: true });
}

/** Replace a project directory from a tar.gz archive (captures are preserved). */
export async function restoreProject(
  config: AgentConfig,
  projectId: string,
  archive: Uint8Array,
): Promise<void> {
  const root = projectDir(config, projectId);
  const extract = tar.extract();
  const writes: Promise<void>[] = [];

  extract.on('entry', (header, stream, next) => {
    const target = resolveWithin(root, header.name);
    if (target === root) {
      stream.resume();
      stream.on('end', () => next());
      return;
    }
    if (header.type === 'directory') {
      writes.push(mkdir(target, { recursive: true }).then(() => undefined));
      stream.resume();
      stream.on('end', () => next());
      return;
    }
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: unknown) => chunks.push(Buffer.from(chunk as Uint8Array)));
    stream.on('end', () => {
      writes.push(
        (async () => {
          await mkdir(path.dirname(target), { recursive: true });
          await Bun.write(target, Buffer.concat(chunks));
        })().then(() => next()),
      );
    });
    stream.resume();
  });

  const done = once(extract, 'finish');
  await pipeline(Readable.from(Buffer.from(gunzipSync(archive))), extract);
  await done;
  await Promise.all(writes);
}

/** Wipe a project directory except captures and logs. */
export async function clearProjectFiles(config: AgentConfig, projectId: string): Promise<void> {
  const root = projectDir(config, projectId);
  for (const entry of ['nodes', 'links', 'meta.json']) {
    await rm(path.join(root, entry), { recursive: true, force: true });
  }
}

export { createGzip };
