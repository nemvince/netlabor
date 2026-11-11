/**
 * Filesystem path helpers. Every path derived from user input must pass through
 * `resolveWithin` so that `..` traversal and symlink escapes are rejected.
 */

import { lstatSync } from 'node:fs';
import path from 'node:path';

export class PathEscapeError extends Error {
  constructor(readonly attempted: string) {
    super(`path escapes root: ${attempted}`);
    this.name = 'PathEscapeError';
  }
}

/**
 * Resolve `relative` inside `root` and return the absolute path.
 * Rejects absolute inputs, `..` escapes, and symlinks in existing components.
 */
export function resolveWithin(root: string, relative: string): string {
  if (relative.includes('\0')) throw new PathEscapeError(relative);
  const normalisedRelative = relative.replace(/^\/+/, '');
  const absoluteRoot = path.resolve(root);
  const target = path.resolve(absoluteRoot, normalisedRelative);
  const rel = path.relative(absoluteRoot, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new PathEscapeError(relative);

  // Reject symlinks anywhere along the existing portion of the path.
  const segments = rel === '' ? [] : rel.split(path.sep);
  let current = absoluteRoot;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new PathEscapeError(relative);
    } catch (err) {
      if (err instanceof PathEscapeError) throw err;
      // Missing components are fine: callers create them.
      break;
    }
  }
  return target;
}

/** Validate a project-relative file path without touching the filesystem. */
export function assertSafeRelative(relative: string): void {
  if (relative.includes('\0')) throw new PathEscapeError(relative);
  if (path.isAbsolute(relative)) throw new PathEscapeError(relative);
  const normalised = path.posix.normalize(relative.replaceAll('\\', '/'));
  if (normalised === '..' || normalised.startsWith('../')) throw new PathEscapeError(relative);
}
