/** Project file access inside a project directory (agents own the files). */

import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '@netlabor/contract';
import { assertSafeRelative, PathEscapeError, resolveWithin } from '@netlabor/shared';
import type { AgentConfig } from '../config.ts';
import { projectDir } from '../dataplane/project.ts';

export interface FileEntry {
  path: string;
  sizeBytes: number;
  mtime: string;
  directory: boolean;
}

function safePathIn(root: string, relative: string): string {
  if (relative === '') return root;
  try {
    assertSafeRelative(relative);
    return resolveWithin(root, relative);
  } catch (error) {
    if (error instanceof PathEscapeError) {
      throw new AppError('BAD_REQUEST', 'path escapes the project directory', {
        details: error.attempted,
      });
    }
    throw error;
  }
}

function safePath(config: AgentConfig, projectId: string, relative: string): string {
  return safePathIn(projectDir(config, projectId), relative);
}

export async function listFiles(
  config: AgentConfig,
  projectId: string,
  relative = '',
): Promise<FileEntry[]> {
  const root = safePath(config, projectId, relative);
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const out: FileEntry[] = [];
    for (const entry of entries) {
      const absolute = path.join(root, entry.name);
      const info = await stat(absolute);
      out.push({
        path: relative === '' ? entry.name : `${relative}/${entry.name}`,
        sizeBytes: info.size,
        mtime: info.mtime.toISOString(),
        directory: entry.isDirectory(),
      });
    }
    return out.sort(
      (a, b) => Number(b.directory) - Number(a.directory) || a.path.localeCompare(b.path),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new AppError('NOT_FOUND', 'path not found');
    throw error;
  }
}

export async function readProjectFile(
  config: AgentConfig,
  projectId: string,
  relative: string,
  encoding?: 'base64',
): Promise<{ path: string; content: string; sizeBytes: number }> {
  const absolute = safePath(config, projectId, relative);
  try {
    const info = await stat(absolute);
    if (info.isDirectory()) throw new AppError('BAD_REQUEST', 'path is a directory');
    if (encoding === 'base64') {
      const data = await readFile(absolute);
      return { path: relative, content: Buffer.from(data).toString('base64'), sizeBytes: info.size };
    }
    const content = await readFile(absolute, 'utf8');
    return { path: relative, content, sizeBytes: info.size };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new AppError('NOT_FOUND', 'file not found');
    throw error;
  }
}

export async function writeProjectFile(
  config: AgentConfig,
  projectId: string,
  relative: string,
  content: string,
  encoding?: 'base64',
): Promise<{ path: string; content: string; sizeBytes: number }> {
  const absolute = safePath(config, projectId, relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  const data =
    encoding === 'base64'
      ? Buffer.from(content, 'base64')
      : new TextEncoder().encode(content);
  await writeFile(absolute, data);
  return { path: relative, content, sizeBytes: data.byteLength };
}

export async function deleteProjectFile(
  config: AgentConfig,
  projectId: string,
  relative: string,
): Promise<void> {
  const absolute = safePath(config, projectId, relative);
  if (absolute === projectDir(config, projectId)) {
    throw new AppError('BAD_REQUEST', 'refusing to delete the project root');
  }
  await rm(absolute, { recursive: true, force: true });
}

/** Root directory for node files (used by the node file procedures). */
export function nodeFileRoot(config: AgentConfig, projectId: string, nodeId: string): string {
  return path.join(projectDir(config, projectId), 'nodes', nodeId);
}

export async function listNodeFiles(
  config: AgentConfig,
  projectId: string,
  nodeId: string,
  relative = '',
): Promise<FileEntry[]> {
  const root = safePathIn(nodeFileRoot(config, projectId, nodeId), relative);
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const out: FileEntry[] = [];
    for (const entry of entries) {
      const info = await stat(path.join(root, entry.name));
      out.push({
        path: relative === '' ? entry.name : `${relative}/${entry.name}`,
        sizeBytes: info.size,
        mtime: info.mtime.toISOString(),
        directory: entry.isDirectory(),
      });
    }
    return out.sort(
      (a, b) => Number(b.directory) - Number(a.directory) || a.path.localeCompare(b.path),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new AppError('NOT_FOUND', 'node directory not found');
    throw error;
  }
}

export async function readNodeFile(
  config: AgentConfig,
  projectId: string,
  nodeId: string,
  relative: string,
): Promise<{ path: string; content: string; sizeBytes: number }> {
  const absolute = safePathIn(nodeFileRoot(config, projectId, nodeId), relative);
  try {
    const info = await stat(absolute);
    if (info.isDirectory()) throw new AppError('BAD_REQUEST', 'path is a directory');
    return { path: relative, content: await readFile(absolute, 'utf8'), sizeBytes: info.size };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new AppError('NOT_FOUND', 'file not found');
    throw error;
  }
}

export async function writeNodeFile(
  config: AgentConfig,
  projectId: string,
  nodeId: string,
  relative: string,
  content: string,
): Promise<{ path: string; content: string; sizeBytes: number }> {
  const absolute = safePathIn(nodeFileRoot(config, projectId, nodeId), relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  const data = new TextEncoder().encode(content);
  await writeFile(absolute, data);
  return { path: relative, content, sizeBytes: data.byteLength };
}

export async function deleteNodeFile(
  config: AgentConfig,
  projectId: string,
  nodeId: string,
  relative: string,
): Promise<void> {
  const root = nodeFileRoot(config, projectId, nodeId);
  const absolute = safePathIn(root, relative);
  if (absolute === root) throw new AppError('BAD_REQUEST', 'refusing to delete the node root');
  await rm(absolute, { recursive: true, force: true });
}
