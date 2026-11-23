/** Agent-side image store: download/copy, sha256 verification, and inventory. */

import type { Dirent } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { AppError, type ImageSource } from '@netlabor/contract';
import type { AgentConfig } from '../config.ts';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PARTIAL_PREFIX = '.partial-';

/** Hashes already computed by this agent, keyed by path; NFS reads are expensive. */
const verifiedFiles = new Map<string, { size: number; mtimeMs: number; sha256: string }>();

export interface EnsureImageInput {
  sha256: string;
  filename: string;
  source: ImageSource;
}

export interface ReplicaFile {
  sha256: string;
  filename: string;
  path: string;
  sizeBytes: number;
}

function assertSha256(sha256: string): string {
  if (!SHA256_PATTERN.test(sha256)) {
    throw new AppError('BAD_REQUEST', 'invalid sha256 digest');
  }
  return sha256;
}

function safeFilename(filename: string): string {
  const base = path.basename(filename);
  if (base !== filename || base === '' || base === '.' || base === '..' || base.includes('\0')) {
    throw new AppError('BAD_REQUEST', 'invalid image filename');
  }
  if (base.length > 255) throw new AppError('BAD_REQUEST', 'image filename is too long');
  return base;
}

async function hashFile(filePath: string): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256');
  for await (const chunk of Bun.file(filePath).stream()) hasher.update(chunk);
  return Buffer.from(hasher.digest()).toString('hex');
}

async function hashIfPresent(
  filePath: string,
): Promise<{ exists: boolean; sha256: string; size: number }> {
  let info;
  try {
    info = await stat(filePath);
  } catch {
    return { exists: false, sha256: '', size: 0 };
  }
  const cached = verifiedFiles.get(filePath);
  if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) {
    return { exists: true, sha256: cached.sha256, size: info.size };
  }
  const sha256 = await hashFile(filePath);
  verifiedFiles.set(filePath, { size: info.size, mtimeMs: info.mtimeMs, sha256 });
  return { exists: true, sha256, size: info.size };
}

function nfsRoot(config: AgentConfig): string {
  if (!config.nfsImageDir) {
    throw new AppError('CAPABILITY_UNSUPPORTED', 'NB_NFS_IMAGE_DIR is not configured');
  }
  return config.nfsImageDir;
}

async function download(
  config: AgentConfig,
  source: { type: 'controller' | 'peer'; url: string; token: string },
  sha256: string,
  filename: string,
): Promise<string> {
  const target = path.join(config.imageDir, sha256, filename);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
  const temp = path.join(path.dirname(target), `${PARTIAL_PREFIX}${process.pid}-${Date.now()}`);

  let response: Response;
  try {
    response = await fetch(source.url, {
      headers: { authorization: `Bearer ${source.token}` },
      signal: AbortSignal.timeout(60 * 60 * 1000),
    });
  } catch (error) {
    throw new AppError('AGENT_ERROR', 'image download failed', {
      details: error instanceof Error ? error.message : String(error),
      retryable: true,
    });
  }
  if (!response.ok || !response.body) {
    throw new AppError(
      response.status === 404 ? 'IMAGE_MISSING' : 'AGENT_ERROR',
      `image download failed with HTTP ${response.status}`,
      { details: { url: source.url, status: response.status }, retryable: response.status >= 500 },
    );
  }

  const hasher = new Bun.CryptoHasher('sha256');
  const writer = Bun.file(temp).writer();
  let size = 0;
  try {
    for await (const chunk of response.body) {
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      hasher.update(bytes);
      size += bytes.byteLength;
      await writer.write(bytes);
    }
    await writer.end();
  } catch (error) {
    try {
      await writer.end();
    } catch {
      // the partial file is removed regardless
    }
    await rm(temp, { force: true }).catch(() => undefined);
    throw new AppError('AGENT_ERROR', 'image download was interrupted', {
      details: error instanceof Error ? error.message : String(error),
      retryable: true,
    });
  }

  const actual = Buffer.from(hasher.digest()).toString('hex');
  if (actual !== sha256) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw new AppError('IMAGE_MISSING', 'downloaded image does not match the expected sha256', {
      details: { expected: sha256, actual, sizeBytes: size },
    });
  }
  await rename(temp, target);
  const info = await stat(target);
  verifiedFiles.set(target, { size: info.size, mtimeMs: info.mtimeMs, sha256 });
  return target;
}

/**
 * Ensure one image replica exists on this compute. Downloads from the
 * controller or a peer, or verifies an NFS/local copy; every path ends in a
 * sha256 verification.
 */
export async function ensureImage(
  config: AgentConfig,
  input: EnsureImageInput,
): Promise<ReplicaFile> {
  const sha256 = assertSha256(input.sha256);
  const filename = safeFilename(input.filename);
  const source = input.source;

  if (source.type === 'nfs' && !config.nfsImageDir) {
    throw new AppError('CAPABILITY_UNSUPPORTED', 'NB_NFS_IMAGE_DIR is not configured');
  }

  if (source.type === 'nfs') {
    const target = path.join(nfsRoot(config), sha256, filename);
    const found = await hashIfPresent(target);
    if (!found.exists) {
      throw new AppError('IMAGE_MISSING', 'image is missing from the NFS image directory', {
        details: { path: target },
      });
    }
    if (found.sha256 !== sha256) {
      throw new AppError('IMAGE_MISSING', 'NFS image does not match the expected sha256', {
        details: { path: target, expected: sha256, actual: found.sha256 },
      });
    }
    return { sha256, filename, path: target, sizeBytes: found.size };
  }

  if (source.type === 'present') {
    const target = path.join(config.imageDir, sha256, filename);
    const found = await hashIfPresent(target);
    if (!found.exists) {
      throw new AppError('IMAGE_MISSING', 'image is not present on this compute', {
        details: { path: target },
      });
    }
    if (found.sha256 !== sha256) {
      throw new AppError('IMAGE_MISSING', 'local image does not match the expected sha256', {
        details: { path: target, expected: sha256, actual: found.sha256 },
      });
    }
    return { sha256, filename, path: target, sizeBytes: found.size };
  }

  const target = await download(config, source, sha256, filename);
  const info = await stat(target);
  return { sha256, filename, path: target, sizeBytes: info.size };
}

/** Every replica file under the active image root. */
export async function listImages(config: AgentConfig): Promise<ReplicaFile[]> {
  const root = config.storageDriver === 'nfs' ? nfsRoot(config) : config.imageDir;
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const results: ReplicaFile[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !SHA256_PATTERN.test(entry.name)) continue;
    const directory = path.join(root, entry.name);
    let files: Dirent[];
    try {
      files = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.isFile() || file.name.startsWith(PARTIAL_PREFIX)) continue;
      const filePath = path.join(directory, file.name);
      try {
        const info = await stat(filePath);
        results.push({
          sha256: entry.name,
          filename: file.name,
          path: filePath,
          sizeBytes: info.size,
        });
      } catch {
        // a replica that disappeared mid-listing is simply absent
      }
    }
  }
  results.sort((a, b) => a.sha256.localeCompare(b.sha256) || a.filename.localeCompare(b.filename));
  return results;
}

/** Remove one replica (or the shared NFS copy) from this compute. */
export async function deleteImage(config: AgentConfig, sha256: string): Promise<void> {
  assertSha256(sha256);
  const root = config.storageDriver === 'nfs' ? nfsRoot(config) : config.imageDir;
  await rm(path.join(root, sha256), { recursive: true, force: true });
}

/** Resolve a blob for the peer-download HTTP route, or null when absent. */
export async function blobFile(
  config: AgentConfig,
  sha256: string,
  filename: string,
): Promise<string | null> {
  if (!SHA256_PATTERN.test(sha256)) return null;
  const base = path.basename(filename);
  if (base !== filename || base === '' || base === '.' || base === '..') return null;
  const roots = [config.imageDir];
  if (config.nfsImageDir) roots.push(config.nfsImageDir);
  for (const root of roots) {
    const candidate = path.join(root, sha256, filename);
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {
      // look in the next root
    }
  }
  return null;
}
